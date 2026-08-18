"use strict";

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

let auth;
let initError;

function readServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const configured = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const candidates = [];
  if (configured) candidates.push(path.resolve(__dirname, "..", configured));
  candidates.push(path.resolve(__dirname, "..", "service-account.json"));

  const filename = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filename) throw new Error("Không tìm thấy Firebase service account");
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function getFirebaseAuth() {
  if (auth) return auth;
  if (initError) throw initError;
  try {
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
