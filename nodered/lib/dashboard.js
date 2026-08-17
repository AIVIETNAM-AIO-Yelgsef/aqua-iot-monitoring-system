"use strict";

function createDashboardService(ctx) {
  const {
    DEFAULT_DEVICE_ID, boundedInteger, cleanText, clonePublic, config,
    deviceIdsForPrincipal, errorCode, finiteNumber, firestoreSet, localState,
    normalizeDeviceId, normalizeSettings, persistLocal, principalCanReadRecord,
    principalHasDeviceAccess, principalUid, publicFeatures,
    publicOpenAIStatus, runtime, safeIso, serviceError, settingsDocumentId,
    settingsForUid
  } = ctx;
  const verifyRequest = (...args) => ctx.api.verifyRequest(...args);
  const publicTelegramStatus = principal => ctx.api.getTelegramStatus(principal);

function normalizeFirestoreDocument(document) {
  const data = document && typeof document.data === "function" ? document.data() : document;
  if (!data || typeof data !== "object") return null;
  const normalized = { ...data };
  if (data.timestamp !== undefined) normalized.timestamp = safeIso(data.timestamp);
  if (data.receivedAt !== undefined) normalized.receivedAt = safeIso(data.receivedAt);
  if (normalized.timestamp && !Number.isFinite(normalized.timestampMs)) {
    normalized.timestampMs = new Date(normalized.timestamp).getTime();
  }
  return clonePublic(normalized);
}

function dashboardRequest(reqOrOptions) {
  if (!reqOrOptions || typeof reqOrOptions !== "object") return { req: reqOrOptions, query: {} };
  if (reqOrOptions.internal === true) {
    return {
      ...reqOrOptions,
      req: reqOrOptions.req || null,
      query: reqOrOptions.query || {}
    };
  }
  if (reqOrOptions.req) {
    return {
      ...reqOrOptions,
      req: reqOrOptions.req,
      query: { ...(reqOrOptions.req.query || {}), ...(reqOrOptions.query || {}) }
    };
  }
  if (reqOrOptions.headers || reqOrOptions.get || reqOrOptions.query) {
    return { req: reqOrOptions, query: reqOrOptions.query || {} };
  }
  return { ...reqOrOptions, req: null, query: reqOrOptions.query || reqOrOptions };
}

async function readHistory(options = {}, principal = null) {
  const hours = envNumberFromValue(options.hours ?? options.historyHours, 24, 1, 24 * 90);
  const limit = boundedInteger(options.limit, 360, 1, 1000);
  const deviceId = cleanText(options.deviceId || "", 80);
  const now = Date.now();
  const explicitFrom = new Date(options.from || 0).getTime();
  const explicitTo = new Date(options.to || now).getTime();
  const fromMs = Number.isFinite(explicitFrom) && explicitFrom > 0 ? explicitFrom : now - hours * 3600000;
  const toMs = Number.isFinite(explicitTo) ? Math.min(explicitTo, now + 300000) : now;

  if (runtime.firestore) {
    try {
      let query = runtime.firestore.collection(config.collections.telemetry)
        .where("timestampMs", ">=", fromMs)
        .where("timestampMs", "<=", toMs)
        .orderBy("timestampMs", "desc")
        .limit(limit);
      const snapshot = await query.get();
      let records = snapshot.docs
        .map(normalizeFirestoreDocument)
        .filter(Boolean)
        .filter(item => principalCanReadRecord(principal, item));
      if (deviceId) records = records.filter(item => item.deviceId === deviceId);
      if (records.length) return records.reverse();
    } catch (error) {
      runtime.firebaseLastError = errorCode(error, "FIRESTORE_HISTORY_READ_FAILED");
      console.warn(`[AquaServices] Firestore history read failed (${runtime.firebaseLastError}); using local history.`);
    }
  }

  return localState.telemetry
    .filter(item => {
      const timestamp = Number(item.timestampMs) || new Date(item.timestamp || item.receivedAt || 0).getTime();
      return principalCanReadRecord(principal, item) &&
        timestamp >= fromMs && timestamp <= toMs && (!deviceId || item.deviceId === deviceId);
    })
    .sort((left, right) => (left.timestampMs || 0) - (right.timestampMs || 0))
    .slice(-limit)
    .map(clonePublic);
}

function envNumberFromValue(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function readAlerts(limit = 50, principal = null, deviceId = "") {
  const boundedLimit = boundedInteger(limit, 50, 1, 200);
  const selectedDeviceId = deviceId ? normalizeDeviceId(deviceId, true) : "";
  if (runtime.firestore) {
    try {
      const snapshot = await runtime.firestore.collection(config.collections.alerts)
        .orderBy("timestamp", "desc")
        .limit(boundedLimit)
        .get();
      const records = snapshot.docs
        .map(normalizeFirestoreDocument)
        .filter(Boolean)
        .filter(item => principalCanReadRecord(principal, item))
        .filter(item => !selectedDeviceId || item.deviceId === selectedDeviceId);
      if (records.length) return records;
    } catch (error) {
      runtime.firebaseLastError = errorCode(error, "FIRESTORE_ALERT_READ_FAILED");
    }
  }
  return localState.alerts
    .filter(item => principalCanReadRecord(principal, item))
    .filter(item => !selectedDeviceId || item.deviceId === selectedDeviceId)
    .slice(-boundedLimit)
    .reverse()
    .map(clonePublic);
}

async function readSettings(principal) {
  const uid = principalUid(principal);
  let settings = settingsForUid(uid);
  if (runtime.firestore && uid && uid !== "demo") {
    try {
      const document = await runtime.firestore.collection(config.collections.system).doc(settingsDocumentId(uid)).get();
      if (document.exists) {
        settings = normalizeSettings(document.data(), settings, false);
        localState.settingsByUid[uid] = settings;
      }
    } catch (error) {
      runtime.firebaseLastError = errorCode(error, "FIRESTORE_SETTINGS_READ_FAILED");
    }
  }
  return clonePublic(settings);
}

async function readProfile(principal) {
  const uid = cleanText(principal && principal.uid || "demo", 128) || "demo";
  if (runtime.firestore && uid !== "demo") {
    try {
      const document = await runtime.firestore.collection(config.collections.profiles).doc(uid).get();
      if (document.exists) {
        const data = document.data();
        return publicProfile({ ...data, uid }, principal);
      }
    } catch (error) {
      runtime.firebaseLastError = errorCode(error, "FIRESTORE_PROFILE_READ_FAILED");
    }
  }
  return publicProfile(localState.profiles[uid] || {}, principal);
}

function publicProfile(profile, principal) {
  return {
    uid: cleanText(principal && principal.uid || profile.uid || "demo", 128),
    name: cleanText(profile.name || principal && principal.name || "Nguoi dung", 100),
    email: cleanText(principal && principal.email || profile.email || "", 254),
    pondName: cleanText(profile.pondName || "Ho ca chinh", 100),
    role: cleanText(principal && principal.role || profile.role || "user", 40),
    demo: Boolean(principal && principal.demo),
    updatedAt: profile.updatedAt ? safeIso(profile.updatedAt) : null
  };
}

function latestForDashboard(history, principal, deviceId = "") {
  const candidate = runtime.latest || localState.latest;
  if (candidate && principalCanReadRecord(principal, candidate) && (!deviceId || candidate.deviceId === deviceId)) {
    return clonePublic(candidate);
  }
  return clonePublic(history.length ? history[history.length - 1] : null);
}

function deviceStatus(latest, principal = null, selectedDeviceId = "") {
  const resolvedDeviceId = selectedDeviceId || latest && latest.deviceId || DEFAULT_DEVICE_ID;
  const hasAccess = principal ? principalHasDeviceAccess(principal, resolvedDeviceId) : true;
  if (!hasAccess) {
    return {
      online: false,
      mqtt: { online: false, value: "unassigned", changedAt: null, message: "Tai khoan chua duoc gan thiet bi" },
      deviceId: null,
      lastSeen: null,
      ageMs: null,
      rssi: null,
      persistence: runtime.firestore ? "firestore" : "local",
      firebaseHealthy: runtime.firebaseReady && !runtime.firebaseLastError,
      assigned: false
    };
  }
  const lastSeenMs = latest ? new Date(latest.receivedAt || latest.timestamp || 0).getTime() : 0;
  const recentlySeen = Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs <= config.deviceOfflineMs;
  const mqttStatus = runtime.mqttStatusByDevice[resolvedDeviceId] || {
    online: false,
    value: "unknown",
    changedAt: null,
    message: "Chua nhan trang thai MQTT cua thiet bi nay"
  };
  return {
    online: Boolean(mqttStatus.online || recentlySeen),
    mqtt: clonePublic(mqttStatus),
    deviceId: resolvedDeviceId,
    lastSeen: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
    ageMs: lastSeenMs ? Math.max(0, Date.now() - lastSeenMs) : null,
    rssi: latest && latest.rssi !== undefined ? latest.rssi : null,
    persistence: runtime.firestore ? (runtime.firebaseLastError ? "local-fallback" : "firestore+local") : "local",
    firebaseHealthy: runtime.firebaseReady && !runtime.firebaseLastError,
    assigned: true
  };
}

async function getDashboard(reqOrOptions) {
  const options = dashboardRequest(reqOrOptions);
  const principal = await verifyRequest(options, options.internal ? { internal: true, principal: options.principal } : {});
  const query = options.query || options;
  const ownedDeviceIds = deviceIdsForPrincipal(principal);
  const requestedDeviceId = query.deviceId ? normalizeDeviceId(query.deviceId, true) : "";
  if (requestedDeviceId && !principalHasDeviceAccess(principal, requestedDeviceId)) {
    throw serviceError(403, "DEVICE_ACCESS_FORBIDDEN", "Tai khoan khong co quyen truy cap thiet bi nay.");
  }
  const selectedDeviceId = requestedDeviceId || ownedDeviceIds[0] || "";
  const scopedQuery = { ...query, deviceId: selectedDeviceId };
  const [history, alerts, settings, profile] = await Promise.all([
    readHistory(scopedQuery, principal),
    readAlerts(query.alertLimit, principal, selectedDeviceId),
    readSettings(principal),
    readProfile(principal)
  ]);
  const latest = latestForDashboard(history, principal, selectedDeviceId);
  return {
    latest,
    history,
    alerts,
    settings,
    profile,
    telegram: publicTelegramStatus(principal),
    assistant: publicOpenAIStatus(),
    status: deviceStatus(latest, principal, selectedDeviceId),
    devices: ownedDeviceIds.map(deviceId => ({
      deviceId,
      selected: deviceId === selectedDeviceId,
      lastSeen: localState.devices[deviceId] && localState.devices[deviceId].lastSeenAt || null
    })),
    features: publicFeatures(principal),
    serverTime: new Date().toISOString()
  };
}


async function saveSettings(input, principal) {
  const uid = principalUid(principal);
  if (!uid) throw serviceError(401, "AUTH_REQUIRED", "Can dang nhap de luu cau hinh.");
  const settings = normalizeSettings(input, settingsForUid(uid), true);
  settings.updatedAt = new Date().toISOString();
  settings.updatedBy = uid;
  localState.settingsByUid[uid] = settings;
  await persistLocal();
  if (runtime.firestore) {
    await firestoreSet(config.collections.system, settingsDocumentId(uid), {
      ...settings,
      ownerUid: uid,
      updatedAt: new Date(settings.updatedAt)
    }, true);
  }
  return clonePublic(settings);
}

async function saveProfile(input, principal) {
  const uid = cleanText(principal.uid, 128);
  const name = cleanText(input.name, 100);
  const pondName = cleanText(input.pondName, 100);
  if (name.length < 2 || pondName.length < 2) {
    throw serviceError(422, "PROFILE_INVALID", "Ho ten va ten ho ca can it nhat 2 ky tu.");
  }
  const profile = {
    uid,
    name,
    pondName,
    email: cleanText(principal.email || "", 254),
    role: cleanText(principal.role || "user", 40),
    updatedAt: new Date().toISOString()
  };
  localState.profiles[uid] = profile;
  if (localState.localAccounts[uid]) {
    localState.localAccounts[uid].name = name;
    localState.localAccounts[uid].updatedAt = profile.updatedAt;
  }
  await persistLocal();
  if (runtime.firestore && uid !== "demo") {
    await firestoreSet(config.collections.profiles, uid, {
      ...profile,
      updatedAt: new Date(profile.updatedAt)
    }, true);
  }
  return publicProfile(profile, { ...principal, name });
}


  return {
    getDashboard, readHistory, readAlerts, readSettings, readProfile,
    saveSettings, saveProfile, deviceStatus
  };
}

module.exports = { createDashboardService };
