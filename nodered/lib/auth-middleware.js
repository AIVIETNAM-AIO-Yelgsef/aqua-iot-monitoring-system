"use strict";

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

let auth;
let initError;

function readServiceAccount() {
    const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (!configuredPath) {
      throw new Error("Chưa cấu hình FIREBASE_SERVICE_ACCOUNT_PATH");
    }

    const serviceAccountPath = path.resolve(
      __dirname,
      "..",
      configuredPath
    );

    return JSON.parse(
      fs.readFileSync(serviceAccountPath, "utf8")
    );
}

function getFirebaseAuth() {
  if (auth) return auth;
  if (initError) throw initError;
  try { // getApps(): hàm trả ds Firebase Admin app trong process
    if (getApps().length === 0) initializeApp({ credential: cert(readServiceAccount()) });
    auth = getAuth();
    return auth;
  } catch (error) {
    initError = error;
    throw error;
  }
}

function jsonError(res, status, message) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error: message }));
}

module.exports = async function firebaseAuthMiddleware(req, res, next) {
  if (!req.url.startsWith("/api/")) return next();

  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return jsonError(res, 401, "Yêu cầu đăng nhập Firebase");

  try {
    req.firebaseUser = await getFirebaseAuth().verifyIdToken(match[1]);
    return next();
  } catch (error) {
    if (error && error.code === "app/invalid-credential") {
      return jsonError(res, 503, "Firebase Authentication chưa được cấu hình trên máy chủ");
    }
    return jsonError(res, 401, "Firebase ID token không hợp lệ hoặc đã hết hạn");
  }
};

module.exports.getFirebaseAuth = getFirebaseAuth;
