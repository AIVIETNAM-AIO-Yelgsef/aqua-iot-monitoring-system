"use strict";

const fs = require("fs");
const path = require("path");
const { createTelegramService } = require("./telegram");
const { createChatbot } = require("./chatbot");

const DEVICE_ID = "hcmus-aqua-18";
const SERVICE_VERSION = "2.0.0";
const DATA_FILE = path.resolve(
  process.env.AQUA_LOCAL_DATA_PATH || path.join(__dirname, "..", "data", "aqua-local.json")
);
const SAVE_INTERVAL = Number(process.env.CLOUD_SAVE_INTERVAL_MS) || 60000;
const ALERT_COOLDOWN = Number(process.env.ALERT_COOLDOWN_MS) || 600000;
const OFFLINE_AFTER = Number(process.env.DEVICE_OFFLINE_MS) || 45000;
const DEMO_AUTH = String(process.env.AQUA_ALLOW_DEMO_AUTH || "true") !== "false";
const TELEGRAM_POLL_INTERVAL = Math.min(60000, Math.max(1000, Number(process.env.TELEGRAM_POLL_INTERVAL_MS) || 3000));
const TELEGRAM_LINK_TTL = Math.min(3600000, Math.max(60000, Number(process.env.TELEGRAM_LINK_TTL_MS) || 600000));
const OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || "").trim().replace(/\/+$/, "");
const CHAT_LIMIT = Math.min(100, Math.max(1, Number(process.env.CHAT_RATE_LIMIT_MAX) || 12));
const CHAT_WINDOW = Math.min(3600000, Math.max(10000, Number(process.env.CHAT_RATE_LIMIT_WINDOW_MS) || 60000));

const defaultSettings = {
  tempMin: 24,
  tempMax: 30,
  phMin: 6.5,
  phMax: 8,
  mode: "MANUAL",
  telegramEnabled: true,
  alertCooldownMs: ALERT_COOLDOWN
};

function number(value, min = -Infinity, max = Infinity) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= min && result <= max ? result : null;
}

function text(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function boolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (/^(true|1|yes|on|online|bat)$/i.test(String(value))) return true;
  if (/^(false|0|no|off|offline|tat)$/i.test(String(value))) return false;
  return fallback;
}

function relayValue(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").toUpperCase();
  if (["ON", "TRUE", "1", "BAT"].includes(normalized)) return true;
  if (["OFF", "FALSE", "0", "TAT"].includes(normalized)) return false;
  return null;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function readLocal() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (_) {
    return {};
  }
}

const saved = readLocal();
const state = {
  latest: saved.latest || null,
  telemetry: Array.isArray(saved.telemetry) ? saved.telemetry : [],
  alerts: Array.isArray(saved.alerts) ? saved.alerts : [],
  activity: Array.isArray(saved.activity) ? saved.activity : [],
  settings: { ...defaultSettings, ...(saved.settings || {}) },
  profiles: saved.profiles || {},
  telegramSubscriptions: saved.telegramSubscriptions || {},
  telegramLinkRequests: saved.telegramLinkRequests || {},
  telegramUpdateOffset: Number.isSafeInteger(saved.telegramUpdateOffset) ? saved.telegramUpdateOffset : 0,
  mqttStatus: saved.mqttStatus || {
    online: false,
    value: "unknown",
    changedAt: null
  }
};

function saveLocal() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({ version: 1, ...state }, null, 2));
}

function keepRecent(list, maximum) {
  if (list.length > maximum) list.splice(0, list.length - maximum);
}

let db = null;
let firebaseAuth = null;
let firebaseError = null;

function startFirebase() {
  try {
    let credential = null;
    const { applicationDefault, cert, getApps, initializeApp } = require("firebase-admin/app");
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const file = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (inline) credential = cert(JSON.parse(inline));
    else if (file) credential = cert(JSON.parse(fs.readFileSync(path.resolve(file), "utf8")));
    else if (process.env.FIREBASE_USE_APPLICATION_DEFAULT === "true") credential = applicationDefault();
    else return;

    const app = getApps().find(item => item.name === "aqua-iot") ||
      initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID }, "aqua-iot");
    db = require("firebase-admin/firestore").getFirestore(app);
    firebaseAuth = require("firebase-admin/auth").getAuth(app);
  } catch (error) {
    firebaseError = error.message;
    console.warn("[Aqua] Firebase disabled:", error.message);
  }
}

startFirebase();

async function cloudSet(collection, id, value, merge = false) {
  if (!db) return false;
  try {
    await db.collection(collection).doc(id).set(value, { merge });
    firebaseError = null;
    return true;
  } catch (error) {
    firebaseError = error.message;
    return false;
  }
}

async function cloudDocument(collection, id) {
  if (!db) return null;
  try {
    const document = await db.collection(collection).doc(id).get();
    firebaseError = null;
    return document.exists ? document.data() : null;
  } catch (error) {
    firebaseError = error.message;
    return null;
  }
}

const telegram = createTelegramService({ state, saveLocal, text, pollInterval: TELEGRAM_POLL_INTERVAL, linkTtl: TELEGRAM_LINK_TTL });
const chatbot = createChatbot({ baseUrl: OPENAI_BASE_URL, limit: CHAT_LIMIT, windowMs: CHAT_WINDOW });

function features() {
  return {
    firebase: Boolean(db),
    firestore: Boolean(db),
    firebaseAuth: Boolean(firebaseAuth),
    localFallback: true,
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    telegramUserLinking: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    openai: chatbot.status().available,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    openaiOfficial: chatbot.status().provider.official,
    mqttControl: true,
    cloudHistory: Boolean(db),
    calibratedPh: Boolean(state.latest?.phCalibrated && Number.isFinite(state.latest?.ph)),
    calibratedTurbidity: Boolean(state.latest?.turbidityCalibrated)
  };
}

function getPublicConfig() {
  const firebase = {
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_APP_ID || ""
  };
  const firebaseClientReady = Boolean(firebase.apiKey && firebase.authDomain && firebase.projectId && firebase.appId);
  return {
    serviceVersion: SERVICE_VERSION,
    firebase: firebaseClientReady ? firebase : null,
    authentication: {
      firebaseConfigured: firebaseClientReady && Boolean(firebaseAuth),
      required: Boolean(firebaseAuth),
      demoAllowed: !firebaseAuth && DEMO_AUTH
    },
    features: features(),
    assistant: chatbot.status()
  };
}

function demoUser() {
  return {
    uid: "demo",
    email: "demo@aquaiot.local",
    name: "Nguoi dung Demo",
    role: "demo",
    demo: true
  };
}

async function verifyRequest(req) {
  if (!firebaseAuth) {
    if (DEMO_AUTH) return demoUser();
    const error = new Error("Firebase Authentication chua duoc cau hinh.");
    error.statusCode = 503;
    throw error;
  }

  const authorization = req?.headers?.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) {
    const error = new Error("Can dang nhap de truy cap he thong.");
    error.statusCode = 401;
    throw error;
  }

  try {
    const user = await firebaseAuth.verifyIdToken(token);
    let role = user.admin ? "admin" : "user";
    if (db && !user.admin) {
      const profile = await db.collection("aquaProfiles").doc(user.uid).get();
      if (profile.exists && profile.data().role === "viewer") role = "viewer";
    }
    return {
      uid: user.uid,
      email: user.email || "",
      name: user.name || user.email || "Nguoi dung",
      role,
      demo: false
    };
  } catch (_) {
    const error = new Error("Token dang nhap khong hop le hoac da het han.");
    error.statusCode = 401;
    throw error;
  }
}

function normalizeTelemetry(input) {
  if (Buffer.isBuffer(input)) input = input.toString("utf8");
  if (typeof input === "string") input = JSON.parse(input);
  if (!input || typeof input !== "object") throw new Error("Telemetry phai la JSON object.");

  const now = Date.now();
  const temperature = number(input.temperature ?? input.temperatureC, -55, 125);
  const ph = number(input.ph ?? input.pH, 0, 14);
  const relay = relayValue(input.relayStatus ?? input.relay ?? input.aerator);
  const timestampMs = number(input.timestampMs, 946684800000, now + 300000) || now;

  const record = {
    id: text(input.id) || makeId("telemetry"),
    deviceId: text(input.deviceId, 80) || DEVICE_ID,
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
    receivedAt: new Date(now).toISOString(),
    temperature,
    temperatureValid: temperature !== null,
    ph,
    phCalibrated: boolean(input.phCalibrated, ph !== null),
    phRaw: number(input.phRaw, 0, 65535),
    phAdcVoltage: number(input.phAdcVoltage ?? input.phADC, 0, 6),
    phVoltage: number(input.phVoltage ?? input.poVoltage, 0, 30),
    turbidity: number(input.turbidity ?? input.ntu, 0, 100000),
    turbidityCalibrated: boolean(input.turbidityCalibrated, false),
    turbidityRaw: number(input.turbidityRaw, 0, 65535),
    turbidityAdcVoltage: number(input.turbidityAdcVoltage ?? input.turbidityADC, 0, 6),
    turbidityVoltage: number(input.turbidityVoltage ?? input.aoVoltage, 0, 30),
    relayStatus: relay === null ? "UNKNOWN" : relay ? "ON" : "OFF",
    relayOn: relay,
    controlMode: String(input.controlMode || input.mode || "MANUAL").toUpperCase() === "AUTO" ? "AUTO" : "MANUAL",
    turbidityAlert: boolean(input.turbidityAlert),
    rssi: number(input.rssi ?? input.wifiRssi, -150, 20),
    uptimeMs: number(input.uptimeMs, 0)
  };

  const hasData = [record.temperature, record.ph, record.phRaw, record.phVoltage,
    record.turbidity, record.turbidityRaw, record.turbidityVoltage].some(value => value !== null);
  if (!hasData && relay === null) throw new Error("Telemetry khong co du lieu hop le.");
  return record;
}

const lastSaved = new Map();
const lastAlert = new Map();

for (const record of state.telemetry) {
  lastSaved.set(record.deviceId || DEVICE_ID, Math.max(lastSaved.get(record.deviceId) || 0, record.timestampMs || 0));
}

for (const alert of state.alerts) {
  if (alert.cooldownKey) lastAlert.set(alert.cooldownKey, new Date(alert.timestamp).getTime());
}

async function addAlert(record, metric, direction, value, threshold, unit) {
  const key = `${record.deviceId}:${metric}:${direction}`;
  const cooldown = Number(state.settings.alertCooldownMs) || ALERT_COOLDOWN;
  if (Date.now() - (lastAlert.get(key) || 0) < cooldown) return null;
  lastAlert.set(key, Date.now());

  const label = metric === "temperature" ? "Nhiet do" : "pH";
  const comparison = direction === "high" ? "cao hon" : "thap hon";
  const alert = {
    id: makeId("alert"),
    deviceId: record.deviceId,
    type: direction === "high" ? "warning" : "danger",
    severity: "warning",
    metric,
    direction,
    value,
    threshold,
    title: `${label} ${comparison} nguong`,
    message: `${label} ${value.toFixed(2)}${unit} ${comparison} nguong ${threshold}${unit}.`,
    timestamp: new Date().toISOString(),
    unread: true,
    cooldownKey: key,
    telegramSent: false
  };

  if (state.settings.telegramEnabled) {
    alert.telegramSent = await telegram.send(`AQUA IoT CANH BAO\n${alert.message}\nThiet bi: ${record.deviceId}`);
  }
  state.alerts.push(alert);
  keepRecent(state.alerts, 500);
  saveLocal();
  await cloudSet("aquaAlerts", alert.id, { ...alert, timestamp: new Date(alert.timestamp) });
  return alert;
}

async function checkAlerts(record) {
  const s = state.settings;
  if (record.temperature !== null) {
    if (record.temperature < s.tempMin) await addAlert(record, "temperature", "low", record.temperature, s.tempMin, " C");
    if (record.temperature > s.tempMax) await addAlert(record, "temperature", "high", record.temperature, s.tempMax, " C");
  }
  if (record.ph !== null && record.phCalibrated) {
    if (record.ph < s.phMin) await addAlert(record, "ph", "low", record.ph, s.phMin, " pH");
    if (record.ph > s.phMax) await addAlert(record, "ph", "high", record.ph, s.phMax, " pH");
  }
}

async function ingestTelemetry(input) {
  const record = normalizeTelemetry(input);
  state.latest = record;

  const previous = lastSaved.get(record.deviceId) || 0;
  const shouldSave = record.timestampMs - previous >= SAVE_INTERVAL || previous === 0;
  let cloudStored = false;
  if (shouldSave) {
    lastSaved.set(record.deviceId, record.timestampMs);
    state.telemetry.push(record);
    keepRecent(state.telemetry, 10000);
    saveLocal();
    cloudStored = await cloudSet("aquaTelemetry", record.id, {
      ...record,
      timestamp: new Date(record.timestamp),
      receivedAt: new Date(record.receivedAt)
    });
  }

  await checkAlerts(record);
  return {
    ...record,
    ok: true,
    telemetry: record,
    stored: shouldSave,
    cloudStored,
    persistence: db && cloudStored ? "firestore+local" : "local"
  };
}

function setMqttStatus(value) {
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  const online = typeof value === "object"
    ? boolean(value.online ?? value.connected)
    : /^(online|connected|true|1)$/i.test(String(value));
  state.mqttStatus = {
    online,
    value: online ? "online" : "offline",
    changedAt: new Date().toISOString()
  };
  saveLocal();
  return state.mqttStatus;
}

async function readHistory(options = {}) {
  const hours = Math.min(2160, Math.max(1, Number(options.hours) || 24));
  const limit = Math.min(1000, Math.max(1, Number(options.limit) || 360));
  const from = Date.now() - hours * 3600000;

  if (db) {
    try {
      const snapshot = await db.collection("aquaTelemetry")
        .where("timestampMs", ">=", from)
        .orderBy("timestampMs", "desc")
        .limit(limit)
        .get();
      if (!snapshot.empty) {
        return snapshot.docs.map(doc => {
          const item = doc.data();
          return {
            ...item,
            timestamp: item.timestamp?.toDate?.().toISOString() || item.timestamp,
            receivedAt: item.receivedAt?.toDate?.().toISOString() || item.receivedAt
          };
        }).reverse();
      }
    } catch (error) {
      firebaseError = error.message;
    }
  }

  return state.telemetry
    .filter(item => (item.timestampMs || new Date(item.timestamp).getTime()) >= from)
    .slice(-limit);
}

function normalizeSettings(input = {}) {
  const source = input.thresholds || input;
  const temperature = source.temperature || {};
  const ph = source.ph || {};
  const next = {
    ...state.settings,
    tempMin: number(source.tempMin ?? temperature.min ?? state.settings.tempMin, -10, 60),
    tempMax: number(source.tempMax ?? temperature.max ?? state.settings.tempMax, -10, 60),
    phMin: number(source.phMin ?? ph.min ?? state.settings.phMin, 0, 14),
    phMax: number(source.phMax ?? ph.max ?? state.settings.phMax, 0, 14),
    telegramEnabled: source.telegramEnabled === undefined
      ? state.settings.telegramEnabled
      : boolean(source.telegramEnabled),
    mode: String(source.mode || state.settings.mode).toUpperCase() === "AUTO" ? "AUTO" : "MANUAL"
  };
  if (next.tempMin === null || next.tempMax === null || next.tempMin >= next.tempMax) throw new Error("Nguong nhiet do khong hop le.");
  if (next.phMin === null || next.phMax === null || next.phMin >= next.phMax) throw new Error("Nguong pH khong hop le.");
  return next;
}

async function saveSettings(input, user = demoUser()) {
  state.settings = {
    ...normalizeSettings(input),
    updatedAt: new Date().toISOString(),
    updatedBy: user.uid
  };
  saveLocal();
  await cloudSet("aquaSystem", "settings", { ...state.settings, updatedAt: new Date(state.settings.updatedAt) }, true);
  return state.settings;
}

async function addActivity(activity) {
  state.activity.push(activity);
  keepRecent(state.activity, 500);
  saveLocal();
  await cloudSet("aquaActivity", activity.id, {
    ...activity,
    timestamp: new Date(activity.timestamp)
  });
}

async function saveProfile(input, user) {
  const profile = {
    uid: user.uid,
    name: text(input.name, 100) || user.name,
    email: user.email || "",
    pondName: text(input.pondName, 100) || "Ho ca chinh",
    role: user.role,
    demo: user.demo,
    updatedAt: new Date().toISOString()
  };
  state.profiles[user.uid] = profile;
  saveLocal();
  if (!user.demo) await cloudSet("aquaProfiles", user.uid, { ...profile, updatedAt: new Date(profile.updatedAt) }, true);
  return profile;
}

function profileFor(user) {
  return state.profiles[user.uid] || {
    uid: user.uid,
    name: user.name,
    email: user.email,
    pondName: "Ho ca chinh",
    role: user.role,
    demo: user.demo,
    updatedAt: null
  };
}

async function loadCloudData(user) {
  if (!db) return;
  const cloudSettings = await cloudDocument("aquaSystem", "settings");
  if (cloudSettings) state.settings = normalizeSettings(cloudSettings);

  if (!user.demo) {
    const cloudProfile = await cloudDocument("aquaProfiles", user.uid);
    if (cloudProfile) state.profiles[user.uid] = { ...cloudProfile, uid: user.uid };
  }
}

async function readAlerts(limit = 50) {
  if (db) {
    try {
      const snapshot = await db.collection("aquaAlerts").orderBy("timestamp", "desc").limit(limit).get();
      if (!snapshot.empty) {
        return snapshot.docs.map(document => {
          const alert = document.data();
          return { ...alert, timestamp: alert.timestamp?.toDate?.().toISOString() || alert.timestamp };
        });
      }
    } catch (error) {
      firebaseError = error.message;
    }
  }
  return state.alerts.slice(-limit).reverse();
}

function deviceStatus() {
  const lastSeen = state.latest ? new Date(state.latest.receivedAt || state.latest.timestamp).getTime() : 0;
  return {
    online: state.mqttStatus.online || Boolean(lastSeen && Date.now() - lastSeen <= OFFLINE_AFTER),
    mqtt: state.mqttStatus,
    deviceId: state.latest?.deviceId || DEVICE_ID,
    lastSeen: lastSeen ? new Date(lastSeen).toISOString() : null,
    ageMs: lastSeen ? Date.now() - lastSeen : null,
    rssi: state.latest?.rssi ?? null,
    persistence: db && !firebaseError ? "firestore+local" : "local",
    firebaseHealthy: Boolean(db && !firebaseError)
  };
}

async function getDashboard(req) {
  const user = await verifyRequest(req);
  await loadCloudData(user);
  const [history, alerts] = await Promise.all([
    readHistory(req?.query || {}),
    readAlerts(50)
  ]);
  return {
    latest: state.latest || history.at(-1) || null,
    history,
    alerts,
    settings: state.settings,
    profile: profileFor(user),
    status: deviceStatus(),
    features: features(),
    telegram: telegram.status(user),
    assistant: chatbot.status(),
    serverTime: new Date().toISOString()
  };
}

function chatContext() {
  const latest = state.latest || {};
  return {
    deviceOnline: deviceStatus().online,
    temperature: latest.temperature,
    ph: latest.phCalibrated ? latest.ph : null,
    turbidityRaw: latest.turbidityRaw,
    relay: latest.relayStatus,
    mode: latest.controlMode,
    settings: state.settings,
    alerts: state.alerts.slice(-5)
  };
}

function localChatAnswer(question, context) {
  const lower = question.toLowerCase();
  if (lower.includes("nhiet")) return `Nhiet do hien tai: ${context.temperature ?? "chua co"} C.`;
  if (lower.includes("ph")) return `pH hien tai: ${context.ph ?? "chua hieu chuan"}.`;
  if (lower.includes("relay") || lower.includes("sui")) return `Relay dang ${context.relay || "chua xac dinh"}.`;
  return `Thiet bi ${context.deviceOnline ? "dang online" : "dang offline"}; nhiet do ${context.temperature ?? "chua co"}; pH ${context.ph ?? "chua hieu chuan"}; relay ${context.relay || "UNKNOWN"}.`;
}

function actionResult(statusCode, response, mqtt = null) {
  return { statusCode, response, mqtt };
}

async function handleAction(body, req) {
  try {
    const user = await verifyRequest(req);
    const action = text(body?.action, 40).toLowerCase();
    if (!action) return actionResult(400, { ok: false, message: "Thieu action." });
    if (user.role === "viewer" && ["relay", "mode", "settings", "profile", "testalert"].includes(action)) {
      return actionResult(403, { ok: false, message: "Tai khoan chi co quyen xem." });
    }

    if (action === "relay") {
      const on = relayValue(body.state ?? body.command ?? body.value ?? body.on);
      if (on === null) return actionResult(422, { ok: false, message: "Trang thai relay khong hop le." });
      const requestId = makeId("web");
      const payload = { deviceId: DEVICE_ID, command: on ? "ON" : "OFF", mode: "MANUAL", requestId };
      await addActivity({
        ...payload,
        id: requestId,
        type: "relay-command",
        requestedBy: user.uid,
        timestamp: new Date().toISOString()
      });
      return actionResult(200, {
        ok: true,
        action,
        command: payload.command,
        mode: payload.mode,
        requestId,
        message: `Da gui lenh ${on ? "BAT" : "TAT"} relay.`
      }, { topic: `aquaiot/${DEVICE_ID}/command`, payload: JSON.stringify(payload), qos: 1, retain: false });
    }

    if (action === "mode") {
      const mode = String(body.mode || body.value).toUpperCase() === "AUTO" ? "AUTO" : "MANUAL";
      await saveSettings({ mode }, user);
      const requestId = makeId("mode");
      const payload = { deviceId: DEVICE_ID, command: "MODE", mode, requestId };
      await addActivity({
        ...payload,
        id: requestId,
        type: "mode-command",
        requestedBy: user.uid,
        timestamp: new Date().toISOString()
      });
      return actionResult(200, { ok: true, action, mode, requestId, settings: state.settings, message: `Da chuyen sang ${mode}.` },
        { topic: `aquaiot/${DEVICE_ID}/command`, payload: JSON.stringify(payload), qos: 1, retain: false });
    }

    if (action === "settings") {
      const settings = await saveSettings(body.settings || body, user);
      return actionResult(200, { ok: true, action, settings });
    }

    if (action === "profile") {
      const profile = await saveProfile(body.profile || body, user);
      return actionResult(200, { ok: true, action, profile });
    }

    if (action === "telegramconnect" || action === "telegram-connect") {
      const connection = await telegram.createLink(user);
      return actionResult(200, { ok: true, action: "telegramConnect", telegram: connection });
    }

    if (action === "telegramdisconnect" || action === "telegram-disconnect") {
      const connection = await telegram.disconnect(user);
      return actionResult(200, { ok: true, action: "telegramDisconnect", telegram: connection });
    }

    if (action === "chat") {
      const question = text(body.question || body.message, 500);
      if (!question) return actionResult(422, { ok: false, message: "Cau hoi dang trong." });
      const context = chatContext();
      const answer = await chatbot.answer(question, user, context, body.history) || localChatAnswer(question, context);
      return actionResult(200, { ok: true, action, answer, source: process.env.OPENAI_API_KEY ? "openai" : "local", model: process.env.OPENAI_MODEL || "gpt-5.4-nano", assistant: chatbot.status() });
    }

    if (action === "testalert" || action === "test-alert") {
      const alert = {
        id: makeId("alert-test"),
        deviceId: DEVICE_ID,
        type: "info",
        severity: "info",
        title: "Kiem tra canh bao Aqua IoT",
        message: "Day la canh bao thu tu website.",
        timestamp: new Date().toISOString(),
        unread: true,
        telegramSent: false
      };
      if (state.settings.telegramEnabled) alert.telegramSent = await telegram.send(alert.message);
      state.alerts.push(alert);
      saveLocal();
      await cloudSet("aquaAlerts", alert.id, { ...alert, timestamp: new Date(alert.timestamp) });
      return actionResult(200, { ok: true, action: "testAlert", alert, message: "Da tao canh bao thu." });
    }

    return actionResult(400, { ok: false, message: "Action khong duoc ho tro." });
  } catch (error) {
    return actionResult(error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : "Backend tam thoi khong xu ly duoc yeu cau."
    });
  }
}

function health() {
  return {
    ok: true,
    serviceVersion: SERVICE_VERSION,
    serverTime: new Date().toISOString(),
    status: deviceStatus(),
    features: features(),
    assistant: chatbot.status()
  };
}

function httpMessage(msg, payload, statusCode = 200) {
  msg.headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  msg.payload = payload;
  msg.statusCode = statusCode;
  return msg;
}

async function flowTelemetry(msg) {
  try {
    const result = await ingestTelemetry(msg.payload);
    msg.payload = result.telemetry;
    msg.topic = "telemetry.valid";
    return [msg, null];
  } catch (error) {
    return [null, { payload: { reason: error.message, telemetry: msg.payload } }];
  }
}

function flowDeviceStatus(msg) {
  let value = Buffer.isBuffer(msg.payload) ? msg.payload.toString("utf8") : msg.payload;
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try { value = JSON.parse(value); } catch (_) { /* plain status string */ }
  }
  const result = setMqttStatus(value);
  msg.payload = result.online ? "ONLINE" : "OFFLINE";
  msg.topic = "device.status";
  return msg;
}

function flowDashboard(payload) {
  const data = payload || {};
  const now = Date.now();
  const updated = new Date(data.timestamp || data.receivedAt || now).toLocaleString("vi-VN");
  const relayOn = relayValue(data.relayStatus) === true;
  const deviceText = `${data.deviceId || DEVICE_ID}${data.rssi == null ? "" : ` | WiFi ${data.rssi} dBm`}`;
  return [
    data.temperature == null ? null : { payload: data.temperature, topic: "Nhiet do", timestamp: now },
    data.turbidityVoltage == null ? null : { payload: data.turbidityVoltage, topic: "Do duc AO", timestamp: now },
    data.ph == null ? null : { payload: data.ph, topic: "Do pH", timestamp: now },
    { payload: data.turbidityRaw == null ? "--" : Math.round(data.turbidityRaw) },
    { payload: data.phRaw == null ? "--" : Math.round(data.phRaw) },
    { payload: relayOn },
    { payload: updated },
    { payload: deviceText }
  ];
}

function flowRelayCommand(msg) {
  const on = relayValue(msg.payload) === true;
  msg.topic = `aquaiot/${DEVICE_ID}/command`;
  msg.payload = JSON.stringify({
    deviceId: DEVICE_ID,
    command: on ? "ON" : "OFF",
    mode: "MANUAL",
    requestId: makeId("dashboard")
  });
  return msg;
}

function flowPublicConfig(msg) {
  return httpMessage(msg, getPublicConfig());
}

async function flowDashboardApi(msg) {
  try {
    return httpMessage(msg, await getDashboard(msg.req));
  } catch (error) {
    return httpMessage(msg, { ok: false, message: error.message }, error.statusCode || 500);
  }
}

async function flowAction(msg) {
  const result = await handleAction(msg.payload || {}, msg.req);
  const response = httpMessage({ req: msg.req, res: msg.res }, result.response, result.statusCode);
  return [result.mqtt, response];
}

function flowHealth(msg) {
  return httpMessage(msg, health());
}

module.exports = {
  getPublicConfig,
  verifyRequest,
  ingestTelemetry,
  setMqttStatus,
  getDashboard,
  saveSettings,
  createTelegramLink: telegram.createLink,
  disconnectTelegram: telegram.disconnect,
  pollTelegram: telegram.poll,
  handleAction,
  health,
  flowTelemetry,
  flowDeviceStatus,
  flowDashboard,
  flowRelayCommand,
  flowPublicConfig,
  flowDashboardApi,
  flowAction,
  flowHealth
};
