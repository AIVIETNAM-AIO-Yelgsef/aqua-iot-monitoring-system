(() => {
  "use strict";

  const SESSION_KEY = "aqua_iot_demo_session";
  const listeners = new Set();
  let publicConfig = {
    authMode: "demo",
    allowDemoAuth: true,
    firebase: null,
    features: {}
  };
  let firebaseAuth = null;
  let firebaseApi = null;
  let currentUser = null;

  function emitAuth(user) {
    currentUser = user || null;
    listeners.forEach(listener => listener(currentUser));
  }

  function demoUser() {
    try {
      const sessionValue = sessionStorage.getItem(SESSION_KEY);
      const localValue = localStorage.getItem(SESSION_KEY);
      const user = JSON.parse(sessionValue || localValue || "null");
      if (!user || typeof user !== "object") return null;
      if (String(user.uid || user.id || "").startsWith("local-") && user.accessToken) {
        return { ...user, remember: !sessionValue };
      }
      if ((user.uid === "demo" || user.id === "demo") && user.email === "demo@aquaiot.local") {
        return { ...user, remember: !sessionValue };
      }
      // Old fake registrations shared uid=demo and could inherit Demo's profile.
      clearDemo();
      return null;
    } catch (_) {
      return null;
    }
  }

  function rememberDemo(user, remember = true) {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify({ ...user, remember }));
  }

  function clearDemo() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  async function loadConfig() {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      publicConfig = { ...publicConfig, ...(await response.json()) };
      if (publicConfig.authentication) {
        publicConfig.authMode = publicConfig.authentication.firebaseConfigured
          ? "firebase"
          : publicConfig.authentication.localAccountsAvailable ? "local" : "demo";
        publicConfig.allowDemoAuth = publicConfig.authentication.demoAllowed !== false;
      }
    } catch (error) {
      publicConfig = {
        ...publicConfig,
        offline: true,
        message: "Không kết nối được Node-RED. Hãy chạy npm start trong thư mục nodered."
      };
    }
  }

  function mapFirebaseUser(user) {
    if (!user) return null;
    return {
      id: user.uid,
      uid: user.uid,
      email: user.email || "",
      name: user.displayName || (user.email ? user.email.split("@")[0] : "Người dùng"),
      role: "user",
      firebaseUser: user
    };
  }

  async function setupFirebase() {
    if (publicConfig.authMode !== "firebase" || !publicConfig.firebase?.apiKey) {
      const storedUser = demoUser();
      if (storedUser?.accessToken) {
        currentUser = storedUser;
        try {
          const result = await request("/api/action", {
            method: "POST",
            body: JSON.stringify({ action: "authSession" })
          });
          const user = { ...storedUser, ...(result.user || {}), accessToken: storedUser.accessToken };
          rememberDemo(user, storedUser.remember !== false);
          emitAuth(user);
        } catch (_) {
          clearDemo();
          emitAuth(null);
        }
      } else {
        emitAuth(storedUser);
      }
      return;
    }

    const version = "12.17.1";
    const [{ initializeApp }, authModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`)
    ]);
    firebaseApi = authModule;
    firebaseAuth = authModule.getAuth(initializeApp(publicConfig.firebase));
    await authModule.setPersistence(firebaseAuth, authModule.browserLocalPersistence);
    await new Promise(resolve => {
      const unsubscribe = authModule.onAuthStateChanged(firebaseAuth, user => {
        emitAuth(mapFirebaseUser(user));
        unsubscribe();
        resolve();
      });
    });
    authModule.onAuthStateChanged(firebaseAuth, user => emitAuth(mapFirebaseUser(user)));
  }

  async function token() {
    if (firebaseAuth?.currentUser) return firebaseAuth.currentUser.getIdToken();
    return currentUser?.accessToken || null;
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const idToken = await token();
    if (idToken) headers.set("Authorization", `Bearer ${idToken}`);
    const response = await fetch(path, { ...options, headers, cache: options.cache || "no-store" });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(data?.message || data?.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  const ready = (async () => {
    await loadConfig();
    try {
      await setupFirebase();
    } catch (error) {
      publicConfig.firebaseError = error.message;
      emitAuth(null);
    }
    return publicConfig;
  })();

  window.AquaAPI = {
    ready,
    get config() { return publicConfig; },
    get currentUser() { return currentUser; },
    get isFirebase() { return publicConfig.authMode === "firebase"; },
    onAuth(listener) {
      listeners.add(listener);
      if (currentUser) queueMicrotask(() => listener(currentUser));
      return () => listeners.delete(listener);
    },
    async signIn(email, password, remember = true) {
      await ready;
      if (firebaseAuth) {
        await firebaseApi.setPersistence(firebaseAuth, remember ? firebaseApi.browserLocalPersistence : firebaseApi.browserSessionPersistence);
        const credential = await firebaseApi.signInWithEmailAndPassword(firebaseAuth, email, password);
        return mapFirebaseUser(credential.user);
      }
      if (publicConfig.authMode !== "local") throw new Error("Hệ thống tài khoản chưa được cấu hình.");
      const result = await request("/api/action", {
        method: "POST",
        body: JSON.stringify({ action: "authLogin", email, password })
      });
      const user = { ...(result.user || {}), accessToken: result.accessToken, expiresAt: result.expiresAt };
      rememberDemo(user, remember);
      emitAuth(user);
      return user;
    },
    async register(name, email, password, deviceId) {
      await ready;
      if (firebaseAuth) {
        const credential = await firebaseApi.createUserWithEmailAndPassword(firebaseAuth, email, password);
        try {
          await firebaseApi.updateProfile(credential.user, { displayName: name });
          const user = mapFirebaseUser(credential.user);
          emitAuth(user);
          await this.action("claimDevice", { deviceId });
          await this.action("profile", { profile: { name, pondName: "Hồ cá chính" } }).catch(() => {});
          return user;
        } catch (error) {
          await firebaseApi.deleteUser(credential.user).catch(() => {});
          emitAuth(null);
          throw error;
        }
      }
      if (publicConfig.authMode !== "local") throw new Error("Hệ thống tài khoản chưa được cấu hình.");
      const result = await request("/api/action", {
        method: "POST",
        body: JSON.stringify({ action: "authRegister", name, email, password, deviceId })
      });
      const user = { ...(result.user || {}), accessToken: result.accessToken, expiresAt: result.expiresAt };
      rememberDemo(user, true);
      emitAuth(user);
      return user;
    },
    async resetPassword(email) {
      await ready;
      if (!firebaseAuth) throw new Error("Đặt lại mật khẩu cần cấu hình Firebase Authentication.");
      return firebaseApi.sendPasswordResetEmail(firebaseAuth, email);
    },
    async signOut() {
      try {
        if (firebaseAuth) await firebaseApi.signOut(firebaseAuth);
        else if (currentUser?.accessToken) {
          await request("/api/action", {
            method: "POST",
            body: JSON.stringify({ action: "authLogout" })
          });
        }
      } finally {
        clearDemo();
        emitAuth(null);
      }
    },
    request,
    getDashboard(hours = 24, full = false) {
      return request(`/api/dashboard?hours=${encodeURIComponent(hours)}&full=${full ? "1" : "0"}`);
    },
    action(action, payload = {}) {
      return request("/api/action", {
        method: "POST",
        body: JSON.stringify({ action, ...payload })
      });
    },
    health() { return request("/api/health"); },
    enterDemo() {
      if (!publicConfig.allowDemoAuth) throw new Error("Chế độ demo đã bị tắt.");
      const user = { id: "demo", uid: "demo", name: "Người dùng Demo", email: "demo@aquaiot.local", role: "demo" };
      rememberDemo(user, true);
      emitAuth(user);
      return user;
    }
  };
})();
