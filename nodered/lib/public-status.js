"use strict";

function createPublicService(ctx) {
  const {
    SERVICE_VERSION, cleanText, config, deviceOwnerUid, localState,
    principalCanReadRecord, runtime
  } = ctx;

function getPublicConfig() {
  const firebase = {
    apiKey: cleanText(process.env.FIREBASE_API_KEY || "", 300),
    authDomain: cleanText(process.env.FIREBASE_AUTH_DOMAIN || "", 300),
    projectId: cleanText(process.env.FIREBASE_PROJECT_ID || "", 200),
    storageBucket: cleanText(process.env.FIREBASE_STORAGE_BUCKET || "", 300),
    messagingSenderId: cleanText(process.env.FIREBASE_MESSAGING_SENDER_ID || "", 100),
    appId: cleanText(process.env.FIREBASE_APP_ID || "", 300)
  };
  const firebaseClientConfigured = Boolean(firebase.apiKey && firebase.authDomain && firebase.projectId && firebase.appId);
  return {
    serviceVersion: SERVICE_VERSION,
    firebase: firebaseClientConfigured ? firebase : null,
    authentication: {
      firebaseConfigured: firebaseClientConfigured && runtime.firebaseReady,
      required: Boolean(runtime.firebaseAuth),
      localAccountsAvailable: !runtime.firebaseAuth && config.allowLocalAuth,
      demoAllowed: !runtime.firebaseAuth && config.allowDemoAuth
    },
    features: publicFeatures()
  };
}

function publicFeatures(principal = null) {
  const assistant = publicOpenAIStatus();
  const readableLatest = principal && runtime.latest && principalCanReadRecord(principal, runtime.latest)
    ? runtime.latest
    : null;
  return {
    firebase: runtime.firebaseReady,
    firestore: runtime.firebaseReady,
    firebaseAuth: Boolean(runtime.firebaseAuth),
    localFallback: true,
    telegram: config.telegramConfigured,
    telegramUserLinking: config.telegramConfigured,
    openai: assistant.available,
    openaiConfigured: config.openaiConfigured,
    openaiOfficial: assistant.provider.official,
    chatbot: true,
    mqttControl: true,
    deviceOwnershipConfigured: Object.values(localState.devices).some(device => Boolean(device.ownerUid)) || Boolean(deviceOwnerUid()),
    deviceClaiming: true,
    cloudHistory: runtime.firebaseReady,
    calibratedPh: Boolean(readableLatest && readableLatest.phCalibrated && Number.isFinite(readableLatest.ph)),
    calibratedTurbidity: Boolean(readableLatest && readableLatest.turbidityCalibrated && Number.isFinite(readableLatest.turbidity))
  };
}

function openAIProvider() {
  if (config.openaiBaseUrlInvalid) {
    return { id: "invalid", label: "Nhà cung cấp AI", hostname: null, official: false };
  }
  const target = config.openaiBaseUrl || "https://api.openai.com/v1";
  const hostname = new URL(target).hostname.toLowerCase();
  if (hostname === "api.openai.com") {
    return { id: "openai", label: "OpenAI", hostname, official: true };
  }
  if (hostname === "api.ccpro.cn") {
    return { id: "ccpro", label: "CCPro", hostname, official: false };
  }
  return { id: "openai-compatible", label: "Dịch vụ AI tương thích OpenAI", hostname, official: false };
}

function publicOpenAIStatus() {
  const reason = config.openaiBaseUrlInvalid ? "OPENAI_BASE_URL_INVALID" : runtime.openaiLastError;
  return {
    configured: config.openaiConfigured,
    available: config.openaiConfigured && !reason,
    degraded: Boolean(config.openaiConfigured && reason),
    model: config.openaiConfigured ? config.openaiModel : null,
    reason,
    provider: openAIProvider(),
    lastSuccessAt: runtime.openaiLastSuccessAt,
    lastFailureAt: runtime.openaiLastFailureAt
  };
}


  return { getPublicConfig, publicFeatures, openAIProvider, publicOpenAIStatus };
}

module.exports = { createPublicService };
