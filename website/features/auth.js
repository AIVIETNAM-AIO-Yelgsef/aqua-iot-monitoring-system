// Firebase Authentication cho website Aqua IoT.
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

// Project Setting in Firebase -> General
// Cấu hình cho Firebase Project mà Frontend kết nối đến
const firebaseConfig = {
  apiKey: "AIzaSyDzEwDodPFopLQ7KXDShT3dvfyv_NYjfE8",
  authDomain: "aqua-iot-d9057.firebaseapp.com",
  projectId: "aqua-iot-d9057",
  storageBucket: "aqua-iot-d9057.firebasestorage.app",
  messagingSenderId: "75160435176",
  appId: "1:75160435176:web:ffb4d374d9d51993e2cc5d",
  measurementId: "G-NWDKP4TQCP"
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp); // Export auth -> module khác dùng được
const db = getFirestore(firebaseApp);

function validateCredentials(email, password) {
  if (!String(email || "").trim()) {
    throw new Error("Vui lòng nhập email.");
  }

  if (String(password || "").length < 6) {
    throw new Error("Mật khẩu phải có ít nhất 6 ký tự.");
  }
}
// Hàm chuyển thông báo lỗi firebase thành thông báo thân thiện -> fallback là Đăng nhập thất bại
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
    await setPersistence(auth, browserLocalPersistence); // Để refresh không bị log out
    const result = await signInWithEmailAndPassword(
      auth,
      String(email).trim().toLowerCase(),
      password
    );
    // Kết quả là UserCredential -> extract user trong đó ra 
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
