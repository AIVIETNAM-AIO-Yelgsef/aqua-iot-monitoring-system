"use strict";

const crypto = require("crypto");

function createAuthService(ctx) {
  const {
    LOCAL_PASSWORD_KEY_BYTES, MAX_LOCAL_ACCOUNTS, MAX_LOCAL_SESSIONS,
    cleanText, config, errorCode, localState, normalizeDeviceId,
    normalizeEmail, parseBoolean, persistLocal, runtime, safeIso,
    serviceError, validEmail
  } = ctx;
  const claimDevice = (...args) => ctx.api.claimDevice(...args);

function bearerToken(req) {
  if (!req || typeof req !== "object") return "";
  const headers = req.headers || {};
  const header = headers.authorization || headers.Authorization ||
    (typeof req.get === "function" ? req.get("authorization") : "");
  const match = String(header || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function localTokenHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function localAccountPublic(account) {
  return {
    id: account.uid,
    uid: account.uid,
    email: account.email,
    name: account.name,
    role: "user",
    demo: false,
    accountMode: "local"
  };
}

function localPrincipal(account) {
  return {
    uid: account.uid,
    email: account.email,
    name: account.name,
    role: "user",
    emailVerified: false,
    demo: false,
    accountMode: "local"
  };
}

function findLocalAccountByEmail(email) {
  const normalized = normalizeEmail(email);
  return Object.values(localState.localAccounts).find(account => account.email === normalized) || null;
}

function deriveLocalPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, LOCAL_PASSWORD_KEY_BYTES, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString("hex"));
    });
  });
}

function cleanupLocalSessions() {
  const now = Date.now();
  let changed = false;
  for (const [tokenHash, session] of Object.entries(localState.localSessions)) {
    const expiresAt = new Date(session && session.expiresAt || 0).getTime();
    if (!localState.localAccounts[session && session.uid] || !Number.isFinite(expiresAt) || expiresAt <= now) {
      delete localState.localSessions[tokenHash];
      changed = true;
    }
  }
  const remaining = Object.entries(localState.localSessions)
    .sort((left, right) => new Date(left[1].createdAt || 0) - new Date(right[1].createdAt || 0));
  while (remaining.length >= MAX_LOCAL_SESSIONS) {
    const [tokenHash] = remaining.shift();
    delete localState.localSessions[tokenHash];
    changed = true;
  }
  return changed;
}

function createLocalSession(account) {
  cleanupLocalSessions();
  const accessToken = `aqua_local_${crypto.randomBytes(32).toString("base64url")}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + config.localSessionTtlMs);
  localState.localSessions[localTokenHash(accessToken)] = {
    uid: account.uid,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  return { accessToken, expiresAt: expiresAt.toISOString() };
}

async function registerLocalAccount(input) {
  if (runtime.firebaseAuth || !config.allowLocalAuth) {
    throw serviceError(409, "LOCAL_AUTH_UNAVAILABLE", "Dang ky cuc bo khong kha dung khi Firebase Authentication dang bat.");
  }
  const name = cleanText(input.name, 100);
  const email = normalizeEmail(input.email);
  const password = String(input.password || "");
  const deviceId = normalizeDeviceId(input.deviceId, true);
  if (name.length < 2) throw serviceError(422, "AUTH_NAME_INVALID", "Ho ten can it nhat 2 ky tu.");
  if (!validEmail(email)) throw serviceError(422, "AUTH_EMAIL_INVALID", "Email khong hop le.");
  if (password.length < 6 || password.length > 128) {
    throw serviceError(422, "AUTH_PASSWORD_INVALID", "Mat khau can tu 6 den 128 ky tu.");
  }
  if (findLocalAccountByEmail(email)) {
    throw serviceError(409, "AUTH_EMAIL_EXISTS", "Email nay da duoc dang ky.");
  }
  if (Object.keys(localState.localAccounts).length >= MAX_LOCAL_ACCOUNTS) {
    throw serviceError(503, "AUTH_ACCOUNT_LIMIT", "He thong cuc bo da dat gioi han tai khoan.");
  }

  const uid = `local-${crypto.randomBytes(12).toString("hex")}`;
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const account = {
    uid,
    email,
    name,
    passwordSalt,
    passwordHash: await deriveLocalPassword(password, passwordSalt),
    disabled: false,
    createdAt: now,
    updatedAt: now
  };
  localState.localAccounts[uid] = account;
  localState.profiles[uid] = {
    uid,
    name,
    email,
    pondName: "Ho ca chinh",
    role: "user",
    updatedAt: now
  };
  const session = createLocalSession(account);
  try {
    const device = await claimDevice(deviceId, localPrincipal(account));
    await persistLocal();
    return { user: localAccountPublic(account), device, ...session };
  } catch (error) {
    delete localState.localAccounts[uid];
    delete localState.profiles[uid];
    for (const [tokenHash, storedSession] of Object.entries(localState.localSessions)) {
      if (storedSession && storedSession.uid === uid) delete localState.localSessions[tokenHash];
    }
    await persistLocal();
    throw error;
  }
}

async function loginLocalAccount(input) {
  if (runtime.firebaseAuth || !config.allowLocalAuth) {
    throw serviceError(409, "LOCAL_AUTH_UNAVAILABLE", "Dang nhap cuc bo khong kha dung khi Firebase Authentication dang bat.");
  }
  const email = normalizeEmail(input.email);
  const password = String(input.password || "");
  const account = findLocalAccountByEmail(email);
  let valid = false;
  if (account && !account.disabled && password.length <= 128) {
    const candidate = await deriveLocalPassword(password, account.passwordSalt);
    const expectedBuffer = Buffer.from(account.passwordHash, "hex");
    const candidateBuffer = Buffer.from(candidate, "hex");
    valid = expectedBuffer.length === candidateBuffer.length && crypto.timingSafeEqual(expectedBuffer, candidateBuffer);
  }
  if (!valid) throw serviceError(401, "AUTH_LOGIN_INVALID", "Email hoac mat khau khong dung.");
  const session = createLocalSession(account);
  await persistLocal();
  return { user: localAccountPublic(account), ...session };
}

function localPrincipalFromRequest(req) {
  const token = bearerToken(req);
  if (!token || !token.startsWith("aqua_local_") || token.length > 160) return null;
  const session = localState.localSessions[localTokenHash(token)];
  if (!session) return null;
  const expiresAt = new Date(session.expiresAt || 0).getTime();
  const account = localState.localAccounts[session.uid];
  if (!account || account.disabled || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return localPrincipal(account);
}

async function logoutLocalAccount(req) {
  const token = bearerToken(req);
  if (token && token.startsWith("aqua_local_") && token.length <= 160) {
    delete localState.localSessions[localTokenHash(token)];
    await persistLocal();
  }
}

function demoPrincipal() {
  return {
    uid: "demo",
    email: "demo@aquaiot.local",
    name: "Nguoi dung Demo",
    role: "demo",
    demo: true
  };
}

async function verifyRequest(reqOrOptions, options = {}) {
  const wrapper = reqOrOptions && reqOrOptions.req ? reqOrOptions : null;
  const req = wrapper ? wrapper.req : reqOrOptions;
  if (options.internal === true || (reqOrOptions && reqOrOptions.internal === true) || (wrapper && wrapper.internal === true)) {
    return options.principal || (reqOrOptions && reqOrOptions.principal) || (wrapper && wrapper.principal) || {
      uid: "system",
      name: "Aqua Backend",
      role: "system",
      demo: false
    };
  }

  if (!runtime.firebaseAuth) {
    const token = bearerToken(req);
    if (token) {
      const principal = config.allowLocalAuth ? localPrincipalFromRequest(req) : null;
      if (principal) return principal;
      throw serviceError(401, "AUTH_INVALID", "Phien dang nhap cuc bo khong hop le hoac da het han.");
    }
    if (config.allowDemoAuth) return demoPrincipal();
    if (config.allowLocalAuth) throw serviceError(401, "AUTH_REQUIRED", "Can dang nhap de truy cap he thong.");
    throw serviceError(503, "AUTH_NOT_CONFIGURED", "Chua cau hinh he thong xac thuc.");
  }

  const token = bearerToken(req);
  if (!token) throw serviceError(401, "AUTH_REQUIRED", "Can dang nhap de truy cap he thong.");

  try {
    const decoded = await runtime.firebaseAuth.verifyIdToken(token, config.checkRevokedTokens);
    const uid = cleanText(decoded.uid || decoded.sub, 128);
    let role = cleanText(decoded.role || (decoded.admin ? "admin" : "user"), 40).toLowerCase();
    // A profile role in Firestore can reduce a normal user's permissions to
    // viewer. Admin custom claims remain authoritative and cannot be escalated
    // by changing a client-writable field.
    if (runtime.firestore && !decoded.admin && !decoded.role) {
      try {
        const snapshot = await runtime.firestore.collection(config.collections.profiles).doc(uid).get();
        const storedRole = cleanText(snapshot.exists && snapshot.data()?.role || "", 40).toLowerCase();
        if (["user", "viewer"].includes(storedRole)) role = storedRole;
      } catch (error) {
        console.warn(`[AquaServices] Profile role lookup failed (${errorCode(error, "PROFILE_ROLE_READ_FAILED")}).`);
      }
    }
    return {
      uid,
      email: cleanText(decoded.email || "", 254),
      name: cleanText(decoded.name || decoded.email || "Nguoi dung", 100),
      role,
      emailVerified: Boolean(decoded.email_verified),
      demo: false
    };
  } catch (error) {
    const code = String(error && error.code || "");
    if (code.includes("revoked") || code.includes("disabled")) {
      throw serviceError(403, "AUTH_FORBIDDEN", "Tai khoan hoac phien dang nhap khong con hieu luc.");
    }
    throw serviceError(401, "AUTH_INVALID", "Token dang nhap khong hop le hoac da het han.");
  }
}


  return {
    registerLocalAccount, loginLocalAccount, localPrincipalFromRequest,
    localAccountPublic, logoutLocalAccount, verifyRequest
  };
}

module.exports = { createAuthService };
