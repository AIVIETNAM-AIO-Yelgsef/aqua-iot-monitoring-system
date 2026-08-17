"use strict";

/**
 * Backend services used by Node-RED Function nodes.
 *
 * Secrets are read only from process.env and are never returned by this module.
 * Firestore is preferred when Firebase Admin credentials are present. A bounded,
 * atomically-written JSON store keeps the classroom/demo setup usable offline.
 */

const path = require("path");
const crypto = require("crypto");

const SERVICE_VERSION = "1.7.0";
const DEFAULT_DEVICE_ID = "esp32-aqua-01";
const MQTT_TOPIC_PREFIX = "aqua-iot/nhom18-24127175-24127257";
const MAX_LOCAL_TELEMETRY = 10000;
const MAX_LOCAL_ALERTS = 500;
const MAX_LOCAL_ACTIVITY = 500;
const MAX_LOCAL_ACCOUNTS = 100;
const MAX_LOCAL_SESSIONS = 200;
const LOCAL_PASSWORD_KEY_BYTES = 64;
const MAX_TELEGRAM_LINK_REQUESTS = 50;
const TELEGRAM_LINK_PREFIX = "aqua_";
const MAX_CHAT_HISTORY_MESSAGES = 10;
const MAX_CHAT_MESSAGE_LENGTH = 500;
const MAX_CHAT_HISTORY_CHARACTERS = 4000;

function envBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function envNumber(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (Number.isFinite(options.min) && parsed < options.min) return null;
  if (Number.isFinite(options.max) && parsed > options.max) return null;
  return parsed;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function cleanText(value, maxLength = 200) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function normalizeDeviceId(value, required = false) {
  const deviceId = cleanText(value || "", 64).toLowerCase();
  if (!deviceId && !required) return "";
  if (!/^[a-z0-9][a-z0-9-]{5,63}$/.test(deviceId)) {
    throw serviceError(422, "DEVICE_ID_INVALID", "Ma thiet bi khong hop le. Hay nhap dung ma hien tren ESP32.");
  }
  return deviceId;
}

function mqttTopic(deviceId, suffix) {
  return `${MQTT_TOPIC_PREFIX}/${normalizeDeviceId(deviceId, true)}/${suffix}`;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (/^(1|true|yes|on|bat)$/i.test(value.trim())) return true;
    if (/^(0|false|no|off|tat)$/i.test(value.trim())) return false;
  }
  return fallback;
}

function relayState(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value === undefined || value === null ? "" : value)
    .trim()
    .toUpperCase();
  if (["ON", "1", "TRUE", "BAT"].includes(normalized)) return true;
  if (["OFF", "0", "FALSE", "TAT"].includes(normalized)) return false;
  return null;
}

function controlMode(value, fallback = "MANUAL", strict = false) {
  const normalized = String(value === undefined || value === null ? fallback : value)
    .trim()
    .toUpperCase();
  if (normalized === "AUTO" || normalized === "MANUAL") return normalized;
  if (strict) throw serviceError(422, "CONTROL_MODE_INVALID", "Che do dieu khien phai la AUTO hoac MANUAL.");
  return fallback;
}

function safeIso(value, fallback = Date.now()) {
  let timestamp = value;
  if (value && typeof value.toDate === "function") timestamp = value.toDate();
  if (value && typeof value === "object" && Number.isFinite(value._seconds)) {
    timestamp = value._seconds * 1000;
  }
  const date = new Date(timestamp === undefined || timestamp === null ? fallback : timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(fallback).toISOString();
}

function clonePublic(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function errorCode(error, fallback = "SERVICE_ERROR") {
  if (!error) return fallback;
  const raw = cleanText(error.code || error.name || fallback, 80);
  return raw || fallback;
}

function serviceError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeOpenAIBaseUrl(value) {
  const raw = cleanText(value || "", 500);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname}`;
  } catch (_) {
    return null;
  }
}

const openaiBaseUrlRaw = cleanText(process.env.OPENAI_BASE_URL || "", 500);
const openaiBaseUrl = normalizeOpenAIBaseUrl(openaiBaseUrlRaw);

const config = Object.freeze({
  localDataPath: path.resolve(
    process.env.AQUA_LOCAL_DATA_PATH || path.join(__dirname, "..", "data", "aqua-local.json")
  ),
  cloudSaveIntervalMs: envNumber("CLOUD_SAVE_INTERVAL_MS", 60000, 1000, 86400000),
  alertCooldownMs: envNumber("ALERT_COOLDOWN_MS", 600000, 10000, 86400000),
  deviceOfflineMs: envNumber("DEVICE_OFFLINE_MS", 45000, 5000, 3600000),
  allowDemoAuth: envBoolean("AQUA_ALLOW_DEMO_AUTH", true),
  allowLocalAuth: envBoolean("AQUA_ALLOW_LOCAL_AUTH", true),
  // Telemetry arrives from MQTT without a browser identity. Bind that single
  // physical device to one Firebase/local uid at the trusted backend instead
  // of accepting an owner supplied by the public MQTT payload.
  deviceOwnerUid: cleanText(process.env.AQUA_DEVICE_OWNER_UID || "", 128),
  localSessionTtlMs: envNumber("AQUA_LOCAL_SESSION_TTL_MS", 2592000000, 3600000, 7776000000),
  checkRevokedTokens: envBoolean("FIREBASE_CHECK_REVOKED_TOKENS", false),
  openaiModel: cleanText(process.env.OPENAI_MODEL || "gpt-5.4-nano", 80),
  openaiBaseUrl: openaiBaseUrl || "",
  openaiBaseUrlInvalid: Boolean(openaiBaseUrlRaw && openaiBaseUrl === null),
  openaiTimeoutMs: envNumber("OPENAI_TIMEOUT_MS", 25000, 5000, 120000),
  openaiMaxOutputTokens: envNumber("OPENAI_MAX_OUTPUT_TOKENS", 500, 100, 2000),
  chatRateLimitMax: envNumber("CHAT_RATE_LIMIT_MAX", 12, 1, 100),
  chatRateLimitWindowMs: envNumber("CHAT_RATE_LIMIT_WINDOW_MS", 60000, 10000, 3600000),
  // A BotFather token is enough for per-user deep-link subscriptions. The old
  // TELEGRAM_CHAT_ID remains an optional, backwards-compatible recipient.
  telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  telegramLegacyChatId: cleanText(process.env.TELEGRAM_CHAT_ID || "", 80),
  telegramPollIntervalMs: envNumber("TELEGRAM_POLL_INTERVAL_MS", 3000, 1000, 60000),
  telegramLinkTtlMs: envNumber("TELEGRAM_LINK_TTL_MS", 600000, 60000, 3600000),
  openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
  collections: Object.freeze({
    telemetry: cleanText(process.env.FIREBASE_TELEMETRY_COLLECTION || "aquaTelemetry", 80),
    alerts: cleanText(process.env.FIREBASE_ALERTS_COLLECTION || "aquaAlerts", 80),
    activity: cleanText(process.env.FIREBASE_ACTIVITY_COLLECTION || "aquaActivity", 80),
    profiles: cleanText(process.env.FIREBASE_PROFILES_COLLECTION || "aquaProfiles", 80),
    devices: cleanText(process.env.FIREBASE_DEVICES_COLLECTION || "aquaDevices", 80),
    system: cleanText(process.env.FIREBASE_SYSTEM_COLLECTION || "aquaSystem", 80)
  })
});

const defaultSettings = Object.freeze({
  tempMin: 24,
  tempMax: 30,
  phMin: 6.5,
  phMax: 8,
  mode: "MANUAL",
  telegramEnabled: true,
  alertCooldownMs: config.alertCooldownMs
});

const emptyLocalState = () => ({
  version: 4,
  latest: null,
  telemetry: [],
  alerts: [],
  activity: [],
  settings: { ...defaultSettings },
  settingsByUid: {},
  devices: {},
  profiles: {},
  localAccounts: {},
  localSessions: {},
  telegramSubscriptions: {},
  telegramLinkRequests: {},
  telegramUpdateOffset: 0,
  telegramBotId: "",
  mqttStatus: {
    online: false,
    value: "unknown",
    changedAt: null,
    message: "Chua nhan trang thai MQTT"
  },
  mqttStatusByDevice: {}
});


function normalizeSettings(input, previous = defaultSettings, strict = true) {
  const source = input && typeof input === "object" ? input : {};
  const thresholds = source.thresholds && typeof source.thresholds === "object" ? source.thresholds : {};
  const temperature = thresholds.temperature && typeof thresholds.temperature === "object"
    ? thresholds.temperature
    : {};
  const ph = thresholds.ph && typeof thresholds.ph === "object" ? thresholds.ph : {};
  const next = {
    ...defaultSettings,
    ...(previous && typeof previous === "object" ? previous : {}),
    tempMin: finiteNumber(source.tempMin ?? temperature.min, { min: -10, max: 60 }),
    tempMax: finiteNumber(source.tempMax ?? temperature.max, { min: -10, max: 60 }),
    phMin: finiteNumber(source.phMin ?? ph.min, { min: 0, max: 14 }),
    phMax: finiteNumber(source.phMax ?? ph.max, { min: 0, max: 14 }),
    mode: controlMode(source.mode, controlMode(previous && previous.mode, defaultSettings.mode, false), strict && source.mode !== undefined),
    telegramEnabled: source.telegramEnabled === undefined
      ? parseBoolean(previous && previous.telegramEnabled, true)
      : parseBoolean(source.telegramEnabled, true),
    alertCooldownMs: finiteNumber(source.alertCooldownMs, { min: 10000, max: 86400000 }) ||
      finiteNumber(previous && previous.alertCooldownMs, { min: 10000, max: 86400000 }) ||
      config.alertCooldownMs
  };
  for (const key of ["tempMin", "tempMax", "phMin", "phMax"]) {
    if (next[key] === null) next[key] = Number((previous && previous[key]) ?? defaultSettings[key]);
  }
  if (strict && next.tempMin >= next.tempMax) {
    throw serviceError(422, "TEMPERATURE_RANGE_INVALID", "Nguong nhiet do toi thieu phai nho hon toi da.");
  }
  if (strict && next.phMin >= next.phMax) {
    throw serviceError(422, "PH_RANGE_INVALID", "Nguong pH toi thieu phai nho hon toi da.");
  }
  if (source.pondName !== undefined || previous && previous.pondName) {
    next.pondName = cleanText(source.pondName ?? previous.pondName, 100) || "Ho ca chinh";
  }
  return next;
}


function createShared() {
  return {
    SERVICE_VERSION, DEFAULT_DEVICE_ID, MQTT_TOPIC_PREFIX,
    MAX_LOCAL_TELEMETRY, MAX_LOCAL_ALERTS, MAX_LOCAL_ACTIVITY,
    MAX_LOCAL_ACCOUNTS, MAX_LOCAL_SESSIONS, LOCAL_PASSWORD_KEY_BYTES,
    MAX_TELEGRAM_LINK_REQUESTS, TELEGRAM_LINK_PREFIX,
    MAX_CHAT_HISTORY_MESSAGES, MAX_CHAT_MESSAGE_LENGTH, MAX_CHAT_HISTORY_CHARACTERS,
    config, defaultSettings, emptyLocalState,
    envBoolean, envNumber, finiteNumber, boundedInteger, cleanText,
    normalizeEmail, normalizeDeviceId, mqttTopic, validEmail, parseBoolean,
    relayState, controlMode, safeIso, clonePublic, errorCode, serviceError,
    makeId, normalizeSettings
  };
}

module.exports = { createShared };
