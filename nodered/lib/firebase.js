"use strict";

const fs = require("fs");
const path = require("path");

function createFirebaseService(ctx) {
  const { config, envBoolean, errorCode, runtime } = ctx;

function firebaseCredentials() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline && inline.trim()) {
    const parsed = JSON.parse(inline);
    if (!parsed || typeof parsed !== "object" || !parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error("INVALID_SERVICE_ACCOUNT_JSON");
    }
    return { kind: "cert", value: parsed };
  }

  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (filePath && filePath.trim()) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
    if (!parsed || typeof parsed !== "object" || !parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error("INVALID_SERVICE_ACCOUNT_FILE");
    }
    return { kind: "cert", value: parsed };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || envBoolean("FIREBASE_USE_APPLICATION_DEFAULT", false)) {
    return { kind: "application-default", value: null };
  }
  return null;
}

function initializeFirebase() {
  let credentials;
  try {
    credentials = firebaseCredentials();
  } catch (error) {
    runtime.firebaseLastError = errorCode(error, "FIREBASE_CREDENTIALS_INVALID");
    console.warn("[AquaServices] Firebase Admin credentials are invalid; local persistence remains active.");
    return;
  }
  if (!credentials) return;

  try {
    const {
      applicationDefault,
      cert,
      getApps,
      initializeApp
    } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    const { getAuth } = require("firebase-admin/auth");
    const appName = "aqua-iot-backend";
    let app = getApps().find(item => item && item.name === appName);
    if (!app) {
      const options = {};
      if (credentials.kind === "cert") {
        options.credential = cert(credentials.value);
        options.projectId = credentials.value.project_id;
      } else {
        options.credential = applicationDefault();
        if (process.env.FIREBASE_PROJECT_ID) options.projectId = process.env.FIREBASE_PROJECT_ID;
      }
      app = initializeApp(options, appName);
    }
    runtime.firestore = getFirestore(app);
    runtime.firestore.settings({ ignoreUndefinedProperties: true });
    runtime.firebaseAuth = getAuth(app);
    runtime.firebaseReady = true;
    runtime.firebaseLastError = null;
  } catch (error) {
    runtime.firebaseLastError = errorCode(error, "FIREBASE_INIT_FAILED");
    runtime.firestore = null;
    runtime.firebaseAuth = null;
    runtime.firebaseReady = false;
    console.warn(`[AquaServices] Firebase Admin unavailable (${runtime.firebaseLastError}); local persistence remains active.`);
  }
}

initializeFirebase();


async function firestoreSet(collection, documentId, value, merge = false) {
  if (!runtime.firestore) return false;
  try {
    await runtime.firestore.collection(collection).doc(documentId).set(value, { merge });
    runtime.firebaseLastError = null;
    return true;
  } catch (error) {
    runtime.firebaseLastError = errorCode(error, "FIRESTORE_WRITE_FAILED");
    console.warn(`[AquaServices] Firestore write failed (${runtime.firebaseLastError}); local fallback was kept.`);
    return false;
  }
}


  return { firestoreSet };
}

module.exports = { createFirebaseService };
