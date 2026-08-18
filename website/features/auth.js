// Firebase Authentication tối giản cho website Aqua IoT.
// Chỉ dùng Web SDK ở trình duyệt; tuyệt đối không đặt service-account.json ở đây.
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from
  "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

import { getFirestore, doc, setDoc, serverTimestamp } from
  "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC3E8PH_A2wx2S26MsZTTkUAe79FqH_e0U",
  authDomain: "aquaiot-89bde.firebaseapp.com",
  projectId: "aquaiot-89bde",
  storageBucket: "aquaiot-89bde.firebasestorage.app",
  messagingSenderId: "700765915930",
  appId: "1:700765915930:web:65b6e20bf4efb809de3aa3"
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

function validateCredentials(email, password) {
  if (!String(email || "").trim()) {
    throw new Error("Vui lòng nhập email.");
  }

  if (String(password || "").length < 6) {
    throw new Error("Mật khẩu phải có ít nhất 6 ký tự.");
  }
}

function friendlyError(error) {
  const messages = {
    "auth/invalid-credential": "Email hoặc mật khẩu không đúng.",
    "auth/invalid-email": "Email không hợp lệ.",
    "auth/user-disabled": "Tài khoản đã bị vô hiệu hóa.",
    "auth/too-many-requests": "Có quá nhiều lần thử. Hãy thử lại sau.",
    "auth/network-request-failed": "Không thể kết nối Firebase."
  };

  return new Error(messages[error?.code] || "Đăng nhập thất bại.");
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function login(email, password) {
  validateCredentials(email, password);

  try {
    await setPersistence(auth, browserLocalPersistence);
    const result = await signInWithEmailAndPassword(
      auth,
      String(email).trim().toLowerCase(),
      password
    );

    return result.user;
  } catch (error) {
    throw friendlyError(error);
  }
}

export async function register(email, password, displayName = "") {
  validateCredentials(email, password);
  try {
    await setPersistence(auth, browserLocalPersistence);
    const result = await createUserWithEmailAndPassword(
      auth,
      String(email).trim().toLowerCase(),
      password
    );
    await setDoc(doc(db, "users", result.user.uid), {
      uid: result.user.uid,
      email: result.user.email,
      displayName: String(displayName || "").trim(),
      deviceId: "aqua_device_01",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return result.user;
  } catch (error) {
    throw friendlyError(error);
  }
}

export async function getIdToken() {
  if (!auth.currentUser) {
    throw new Error("Bạn chưa đăng nhập.");
  }

  return auth.currentUser.getIdToken();
}

export function currentUser() {
  return auth.currentUser;
}

export function logout() {
  return signOut(auth);
}
