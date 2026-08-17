"use strict";

const fs = require("fs");
const path = require("path");

function createStore(ctx) {
  const {
    DEFAULT_DEVICE_ID, MAX_LOCAL_ACCOUNTS, MAX_LOCAL_ACTIVITY,
    MAX_LOCAL_ALERTS, MAX_LOCAL_SESSIONS, MAX_LOCAL_TELEMETRY,
    boundedInteger, cleanText, config, defaultSettings, emptyLocalState,
    errorCode, normalizeDeviceId, normalizeEmail, normalizeSettings,
    parseBoolean, safeIso, serviceError, validEmail
  } = ctx;

function sanitizeLoadedState(input) {
  const base = emptyLocalState();
  if (!input || typeof input !== "object" || Array.isArray(input)) return base;
  base.latest = input.latest && typeof input.latest === "object" ? input.latest : null;
  base.telemetry = Array.isArray(input.telemetry)
    ? input.telemetry.filter(item => item && typeof item === "object").slice(-MAX_LOCAL_TELEMETRY)
    : [];
  base.alerts = Array.isArray(input.alerts)
    ? input.alerts.filter(item => item && typeof item === "object").slice(-MAX_LOCAL_ALERTS)
    : [];
  base.activity = Array.isArray(input.activity)
    ? input.activity.filter(item => item && typeof item === "object").slice(-MAX_LOCAL_ACTIVITY)
    : [];
  base.settings = normalizeSettings(input.settings, defaultSettings, false);
  if (input.settingsByUid && typeof input.settingsByUid === "object" && !Array.isArray(input.settingsByUid)) {
    for (const [rawUid, rawSettings] of Object.entries(input.settingsByUid)) {
      const uid = cleanText(rawUid, 128);
      if (!uid || !rawSettings || typeof rawSettings !== "object") continue;
      base.settingsByUid[uid] = normalizeSettings(rawSettings, defaultSettings, false);
    }
  }
  if (input.devices && typeof input.devices === "object" && !Array.isArray(input.devices)) {
    for (const [rawDeviceId, rawDevice] of Object.entries(input.devices)) {
      if (!rawDevice || typeof rawDevice !== "object") continue;
      let deviceId;
      try { deviceId = normalizeDeviceId(rawDeviceId || rawDevice.deviceId, true); } catch (_) { continue; }
      base.devices[deviceId] = {
        deviceId,
        ownerUid: cleanText(rawDevice.ownerUid || "", 128),
        firstSeenAt: rawDevice.firstSeenAt ? safeIso(rawDevice.firstSeenAt) : null,
        lastSeenAt: rawDevice.lastSeenAt ? safeIso(rawDevice.lastSeenAt) : null,
        claimedAt: rawDevice.claimedAt ? safeIso(rawDevice.claimedAt) : null
      };
    }
  }
  base.profiles = input.profiles && typeof input.profiles === "object" && !Array.isArray(input.profiles)
    ? input.profiles
    : {};
  if (input.localAccounts && typeof input.localAccounts === "object" && !Array.isArray(input.localAccounts)) {
    for (const [rawUid, rawAccount] of Object.entries(input.localAccounts).slice(0, MAX_LOCAL_ACCOUNTS)) {
      if (!rawAccount || typeof rawAccount !== "object") continue;
      const uid = cleanText(rawUid, 128);
      const email = normalizeEmail(rawAccount.email);
      const passwordSalt = cleanText(rawAccount.passwordSalt, 64).toLowerCase();
      const passwordHash = cleanText(rawAccount.passwordHash, 128).toLowerCase();
      if (!/^local-[a-f0-9]{24}$/.test(uid) || !validEmail(email)) continue;
      if (!/^[a-f0-9]{32}$/.test(passwordSalt) || !/^[a-f0-9]{128}$/.test(passwordHash)) continue;
      base.localAccounts[uid] = {
        uid,
        email,
        name: cleanText(rawAccount.name || email.split("@")[0] || "Nguoi dung", 100),
        passwordSalt,
        passwordHash,
        disabled: parseBoolean(rawAccount.disabled, false),
        createdAt: safeIso(rawAccount.createdAt),
        updatedAt: safeIso(rawAccount.updatedAt || rawAccount.createdAt)
      };
    }
  }
  if (input.localSessions && typeof input.localSessions === "object" && !Array.isArray(input.localSessions)) {
    const now = Date.now();
    const sessions = Object.entries(input.localSessions)
      .filter(([, session]) => session && typeof session === "object")
      .sort((left, right) => new Date(right[1].createdAt || 0) - new Date(left[1].createdAt || 0));
    for (const [rawHash, rawSession] of sessions.slice(0, MAX_LOCAL_SESSIONS)) {
      const tokenHash = cleanText(rawHash, 64).toLowerCase();
      const uid = cleanText(rawSession.uid, 128);
      const expiresAtMs = new Date(rawSession.expiresAt || 0).getTime();
      if (!/^[a-f0-9]{64}$/.test(tokenHash) || !base.localAccounts[uid]) continue;
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) continue;
      base.localSessions[tokenHash] = {
        uid,
        createdAt: safeIso(rawSession.createdAt),
        expiresAt: new Date(expiresAtMs).toISOString()
      };
    }
  }
  if (input.telegramSubscriptions && typeof input.telegramSubscriptions === "object" && !Array.isArray(input.telegramSubscriptions)) {
    for (const [rawUid, rawSubscription] of Object.entries(input.telegramSubscriptions)) {
      const uid = cleanText(rawUid, 128);
      if (!uid || !rawSubscription || typeof rawSubscription !== "object") continue;
      const chatId = cleanText(rawSubscription.chatId, 80);
      if (!/^-?\d{1,30}$/.test(chatId)) continue;
      base.telegramSubscriptions[uid] = {
        uid,
        chatId,
        telegramUserId: cleanText(rawSubscription.telegramUserId, 80),
        username: cleanText(rawSubscription.username, 64),
        firstName: cleanText(rawSubscription.firstName, 100),
        lastName: cleanText(rawSubscription.lastName, 100),
        active: parseBoolean(rawSubscription.active, true),
        connectedAt: safeIso(rawSubscription.connectedAt),
        updatedAt: safeIso(rawSubscription.updatedAt || rawSubscription.connectedAt)
      };
    }
  }
  if (input.telegramLinkRequests && typeof input.telegramLinkRequests === "object" && !Array.isArray(input.telegramLinkRequests)) {
    const now = Date.now();
    for (const [rawHash, rawRequest] of Object.entries(input.telegramLinkRequests)) {
      const tokenHash = cleanText(rawHash, 64).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(tokenHash) || !rawRequest || typeof rawRequest !== "object") continue;
      const uid = cleanText(rawRequest.uid, 128);
      const expiresAtMs = new Date(rawRequest.expiresAt || 0).getTime();
      if (!uid || !Number.isFinite(expiresAtMs) || expiresAtMs <= now) continue;
      base.telegramLinkRequests[tokenHash] = {
        uid,
        createdAt: safeIso(rawRequest.createdAt),
        expiresAt: new Date(expiresAtMs).toISOString()
      };
    }
  }
  base.telegramUpdateOffset = boundedInteger(input.telegramUpdateOffset, 0, 0, Number.MAX_SAFE_INTEGER);
  base.telegramBotId = cleanText(input.telegramBotId || "", 80);
  if (input.mqttStatus && typeof input.mqttStatus === "object") {
    base.mqttStatus = {
      online: parseBoolean(input.mqttStatus.online, false),
      value: cleanText(input.mqttStatus.value || "unknown", 40),
      changedAt: input.mqttStatus.changedAt ? safeIso(input.mqttStatus.changedAt) : null,
      message: cleanText(input.mqttStatus.message || "", 160)
    };
  }
  if (input.mqttStatusByDevice && typeof input.mqttStatusByDevice === "object" && !Array.isArray(input.mqttStatusByDevice)) {
    for (const [rawDeviceId, rawStatus] of Object.entries(input.mqttStatusByDevice)) {
      if (!rawStatus || typeof rawStatus !== "object") continue;
      let deviceId;
      try { deviceId = normalizeDeviceId(rawDeviceId, true); } catch (_) { continue; }
      base.mqttStatusByDevice[deviceId] = {
        online: parseBoolean(rawStatus.online, false),
        value: cleanText(rawStatus.value || "unknown", 40),
        changedAt: rawStatus.changedAt ? safeIso(rawStatus.changedAt) : null,
        message: cleanText(rawStatus.message || "", 160)
      };
    }
  }
  return base;
}

function loadLocalState() {
  try {
    if (!fs.existsSync(config.localDataPath)) return emptyLocalState();
    const text = fs.readFileSync(config.localDataPath, "utf8");
    if (!text.trim()) return emptyLocalState();
    return sanitizeLoadedState(JSON.parse(text));
  } catch (error) {
    // Do not print a credential, payload, or filesystem content in logs.
    console.warn(`[AquaServices] Local store could not be loaded (${errorCode(error, "LOCAL_READ_FAILED")}).`);
    return emptyLocalState();
  }
}

const localState = loadLocalState();
if (config.deviceOwnerUid && !localState.devices[DEFAULT_DEVICE_ID]) {
  localState.devices[DEFAULT_DEVICE_ID] = {
    deviceId: DEFAULT_DEVICE_ID,
    ownerUid: config.deviceOwnerUid,
    firstSeenAt: null,
    lastSeenAt: null,
    claimedAt: new Date().toISOString()
  };
}
let localWriteQueue = Promise.resolve();

function principalUid(principal) {
  return cleanText(principal && principal.uid || "", 128);
}

function deviceOwnerUid() {
  return config.deviceOwnerUid;
}

function deviceOwnerForId(deviceId) {
  let normalized;
  try { normalized = normalizeDeviceId(deviceId || DEFAULT_DEVICE_ID, true); } catch (_) { return ""; }
  const registered = localState.devices[normalized];
  if (registered && registered.ownerUid) return cleanText(registered.ownerUid, 128);
  return normalized === DEFAULT_DEVICE_ID ? deviceOwnerUid() : "";
}

function deviceIdsForPrincipal(principal) {
  const uid = principalUid(principal);
  if (!uid) return [];
  const ids = Object.values(localState.devices)
    .filter(device => cleanText(device.ownerUid, 128) === uid)
    .map(device => device.deviceId);
  if (uid === deviceOwnerUid() && !ids.includes(DEFAULT_DEVICE_ID)) ids.push(DEFAULT_DEVICE_ID);
  return [...new Set(ids)].sort();
}

function recordOwnerUid(record) {
  const explicit = cleanText(record && record.ownerUid || "", 128);
  const requester = cleanText(record && record.requestedBy || "", 128);
  // Records written before multi-user isolation did not contain ownerUid.
  // User-created records retain requestedBy; only legacy physical telemetry
  // without either field belongs to the configured original device owner.
  if (explicit && explicit !== "unassigned") return explicit;
  return requester || deviceOwnerForId(record && record.deviceId);
}

function principalHasDeviceAccess(principal, deviceId = DEFAULT_DEVICE_ID) {
  const uid = principalUid(principal);
  let requestedDevice;
  try { requestedDevice = normalizeDeviceId(deviceId || DEFAULT_DEVICE_ID, true); } catch (_) { return false; }
  return Boolean(uid && uid === deviceOwnerForId(requestedDevice));
}

function principalCanReadRecord(principal, record) {
  const uid = principalUid(principal);
  return Boolean(uid && recordOwnerUid(record) === uid);
}

function settingsForUid(uid) {
  const key = cleanText(uid || "", 128);
  if (!key) return { ...defaultSettings };
  if (localState.settingsByUid[key]) return normalizeSettings(localState.settingsByUid[key], defaultSettings, false);
  // Migrate the former global settings only to the configured physical-device
  // owner. Every other account starts with clean defaults.
  const initial = deviceIdsForPrincipal({ uid: key }).length > 0
    ? normalizeSettings(localState.settings, defaultSettings, false)
    : { ...defaultSettings };
  localState.settingsByUid[key] = initial;
  return normalizeSettings(initial, defaultSettings, false);
}

function settingsDocumentId(uid) {
  return `settings-${crypto.createHash("sha256").update(String(uid || ""), "utf8").digest("hex").slice(0, 40)}`;
}

function requireDeviceAccess(principal, deviceId = DEFAULT_DEVICE_ID) {
  if (!principalHasDeviceAccess(principal, deviceId)) {
    throw serviceError(403, "DEVICE_ACCESS_FORBIDDEN", "Tai khoan nay chua duoc gan voi thiet bi ho ca.");
  }
}

function resolveDeviceForPrincipal(principal, requestedDeviceId = "") {
  const requested = requestedDeviceId ? normalizeDeviceId(requestedDeviceId, true) : "";
  if (requested) {
    requireDeviceAccess(principal, requested);
    return requested;
  }
  const [first] = deviceIdsForPrincipal(principal);
  if (!first) throw serviceError(403, "DEVICE_ACCESS_FORBIDDEN", "Tai khoan nay chua lien ket voi thiet bi nao.");
  return first;
}

function localSnapshot() {
  return {
    version: 4,
    savedAt: new Date().toISOString(),
    latest: localState.latest,
    telemetry: localState.telemetry.slice(-MAX_LOCAL_TELEMETRY),
    alerts: localState.alerts.slice(-MAX_LOCAL_ALERTS),
    activity: localState.activity.slice(-MAX_LOCAL_ACTIVITY),
    settings: localState.settings,
    settingsByUid: localState.settingsByUid,
    devices: localState.devices,
    profiles: localState.profiles,
    localAccounts: localState.localAccounts,
    localSessions: localState.localSessions,
    telegramSubscriptions: localState.telegramSubscriptions,
    telegramLinkRequests: localState.telegramLinkRequests,
    telegramUpdateOffset: localState.telegramUpdateOffset,
    telegramBotId: localState.telegramBotId,
    mqttStatus: localState.mqttStatus,
    mqttStatusByDevice: localState.mqttStatusByDevice
  };
}

function persistLocal() {
  localWriteQueue = localWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const directory = path.dirname(config.localDataPath);
      const temporary = `${config.localDataPath}.${process.pid}.tmp`;
      await fs.promises.mkdir(directory, { recursive: true });
      await fs.promises.writeFile(temporary, JSON.stringify(localSnapshot(), null, 2), {
        encoding: "utf8",
        mode: 0o600
      });
      await fs.promises.rename(temporary, config.localDataPath);
    })
    .catch(error => {
      console.warn(`[AquaServices] Local store write failed (${errorCode(error, "LOCAL_WRITE_FAILED")}).`);
    });
  return localWriteQueue;
}

const runtime = {
  latest: localState.latest,
  mqttStatus: localState.mqttStatus,
  mqttStatusByDevice: localState.mqttStatusByDevice,
  lastSavedAtByDevice: new Map(),
  lastAlertAtByKey: new Map(),
  firebaseReady: false,
  firebaseLastError: null,
  firestore: null,
  firebaseAuth: null,
  openaiClient: null,
  openaiLastError: null,
  openaiLastFailureAt: null,
  openaiLastSuccessAt: null,
  chatRateLimits: new Map(),
  telegramBot: null,
  telegramPolling: false,
  telegramPollTimer: null,
  telegramLastPollAt: null,
  telegramLastError: null
};

for (const item of localState.telemetry) {
  let deviceId;
  try { deviceId = normalizeDeviceId(item.deviceId || DEFAULT_DEVICE_ID, true); } catch (_) { continue; }
  const timestamp = new Date(item.timestamp || item.receivedAt || 0).getTime();
  if (Number.isFinite(timestamp)) {
    runtime.lastSavedAtByDevice.set(deviceId, Math.max(runtime.lastSavedAtByDevice.get(deviceId) || 0, timestamp));
    if (!localState.devices[deviceId]) {
      localState.devices[deviceId] = {
        deviceId,
        ownerUid: cleanText(item.ownerUid || "", 128) === "unassigned" ? "" : cleanText(item.ownerUid || "", 128),
        firstSeenAt: safeIso(item.receivedAt || item.timestamp),
        lastSeenAt: safeIso(item.receivedAt || item.timestamp),
        claimedAt: null
      };
    }
  }
}
for (const alert of localState.alerts) {
  const key = cleanText(alert.cooldownKey || "", 160);
  const timestamp = new Date(alert.timestamp || 0).getTime();
  if (key && Number.isFinite(timestamp)) {
    runtime.lastAlertAtByKey.set(key, Math.max(runtime.lastAlertAtByKey.get(key) || 0, timestamp));
  }
}


  return {
    localState, runtime, persistLocal, principalUid, deviceOwnerUid,
    deviceOwnerForId, deviceIdsForPrincipal, recordOwnerUid,
    principalHasDeviceAccess, principalCanReadRecord, settingsForUid,
    settingsDocumentId, requireDeviceAccess, resolveDeviceForPrincipal
  };
}

module.exports = { createStore };
