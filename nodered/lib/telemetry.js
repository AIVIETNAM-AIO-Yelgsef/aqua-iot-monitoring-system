"use strict";

function createTelemetryService(ctx) {
  const {
    MAX_LOCAL_ACTIVITY, MAX_LOCAL_ALERTS, MAX_LOCAL_TELEMETRY, cleanText,
    clonePublic, config, controlMode, deviceOwnerForId, finiteNumber,
    firestoreSet, localState, makeId, normalizeDeviceId, parseBoolean,
    persistLocal, recordOwnerUid, relayState, runtime, serviceError,
    settingsForUid
  } = ctx;
  const registerDeviceSeen = (...args) => ctx.api.registerDeviceSeen(...args);
  const sendTelegram = (...args) => ctx.api.sendTelegram(...args);

function normalizeTelemetry(raw) {
  let input = raw;
  if (Buffer.isBuffer(input)) input = input.toString("utf8");
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > 65536) {
      throw serviceError(413, "TELEMETRY_TOO_LARGE", "Goi telemetry vuot qua gioi han.");
    }
    try {
      input = JSON.parse(input);
    } catch (_) {
      throw serviceError(400, "TELEMETRY_INVALID_JSON", "Telemetry khong phai JSON hop le.");
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw serviceError(400, "TELEMETRY_INVALID", "Telemetry phai la mot JSON object.");
  }

  const now = Date.now();
  const suppliedTime = finiteNumber(input.timestampMs, { min: 946684800000, max: now + 300000 });
  const parsedTime = suppliedTime || new Date(input.timestamp || input.receivedAt || now).getTime();
  const timestampMs = Number.isFinite(parsedTime) && parsedTime >= 946684800000 && parsedTime <= now + 300000
    ? parsedTime
    : now;
  const temperature = finiteNumber(input.temperature ?? input.temperatureC, { min: -55, max: 125 });
  const ph = finiteNumber(input.ph ?? input.pH, { min: 0, max: 14 });
  const turbidity = finiteNumber(input.turbidity ?? input.ntu ?? input.turbidityNtu, { min: 0, max: 100000 });
  const relay = relayState(input.relayStatus ?? input.relay ?? input.aerator);

  const normalized = {
    id: cleanText(input.id || makeId("telemetry"), 120),
    deviceId: normalizeDeviceId(input.deviceId || DEFAULT_DEVICE_ID, true),
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
    receivedAt: new Date(now).toISOString(),
    temperature,
    temperatureValid: temperature !== null,
    ph,
    phCalibrated: parseBoolean(input.phCalibrated, ph !== null),
    phRaw: finiteNumber(input.phRaw, { min: 0, max: 65535 }),
    phAdcVoltage: finiteNumber(input.phAdcVoltage ?? input.phADC, { min: 0, max: 6 }),
    phVoltage: finiteNumber(input.phVoltage ?? input.poVoltage, { min: 0, max: 30 }),
    turbidity,
    turbidityCalibrated: parseBoolean(input.turbidityCalibrated, turbidity !== null),
    turbidityRaw: finiteNumber(input.turbidityRaw, { min: 0, max: 65535 }),
    turbidityAdcVoltage: finiteNumber(input.turbidityAdcVoltage ?? input.turbidityADC, { min: 0, max: 6 }),
    turbidityVoltage: finiteNumber(input.turbidityVoltage ?? input.aoVoltage, { min: 0, max: 30 }),
    relayStatus: relay === null ? "UNKNOWN" : relay ? "ON" : "OFF",
    relayOn: relay,
    controlMode: controlMode(input.controlMode ?? input.mode, "MANUAL", false),
    turbidityAlert: parseBoolean(input.turbidityAlert, false),
    turbidityThreshold: finiteNumber(input.turbidityThreshold, { min: 0, max: 100000 }),
    turbidityThresholdMetric: cleanText(input.turbidityThresholdMetric || "", 40),
    turbidityThresholdDirection: cleanText(input.turbidityThresholdDirection || "", 20),
    rssi: finiteNumber(input.rssi, { min: -150, max: 20 }),
    uptimeMs: finiteNumber(input.uptimeMs, { min: 0, max: Number.MAX_SAFE_INTEGER })
  };

  const hasSensorValue = [
    normalized.temperature,
    normalized.ph,
    normalized.phRaw,
    normalized.phVoltage,
    normalized.turbidity,
    normalized.turbidityRaw,
    normalized.turbidityVoltage
  ].some(value => value !== null);
  if (!hasSensorValue && relay === null) {
    throw serviceError(422, "TELEMETRY_EMPTY", "Telemetry khong co gia tri cam bien hop le.");
  }
  return normalized;
}


function firestoreTelemetry(record) {
  return {
    ...record,
    timestamp: new Date(record.timestamp),
    receivedAt: new Date(record.receivedAt)
  };
}

async function storeTelemetry(record) {
  localState.latest = record;
  localState.telemetry.push(record);
  if (localState.telemetry.length > MAX_LOCAL_TELEMETRY) {
    localState.telemetry.splice(0, localState.telemetry.length - MAX_LOCAL_TELEMETRY);
  }
  await persistLocal();

  if (!runtime.firestore) return false;
  const cloudRecord = firestoreTelemetry(record);
  const stored = await firestoreSet(config.collections.telemetry, record.id, cloudRecord, false);
  if (stored) {
    await firestoreSet(config.collections.system, `latest-${record.deviceId}`, cloudRecord, false);
  }
  return stored;
}

async function persistAlert(alert) {
  localState.alerts.push(alert);
  if (localState.alerts.length > MAX_LOCAL_ALERTS) {
    localState.alerts.splice(0, localState.alerts.length - MAX_LOCAL_ALERTS);
  }
  await persistLocal();
  if (runtime.firestore) {
    await firestoreSet(config.collections.alerts, alert.id, {
      ...alert,
      timestamp: new Date(alert.timestamp)
    }, false);
  }
}

async function persistActivity(activity) {
  localState.activity.push(activity);
  if (localState.activity.length > MAX_LOCAL_ACTIVITY) {
    localState.activity.splice(0, localState.activity.length - MAX_LOCAL_ACTIVITY);
  }
  await persistLocal();
  if (runtime.firestore) {
    await firestoreSet(config.collections.activity, activity.id, {
      ...activity,
      timestamp: new Date(activity.timestamp)
    }, false);
  }
}


function alertCandidate(record, metric, direction, value, threshold, unit) {
  const label = metric === "temperature" ? "Nhiệt độ" : "pH";
  const comparison = direction === "high" ? "cao hơn" : "thấp hơn";
  const displayValue = metric === "temperature" ? value.toFixed(2) : value.toFixed(2);
  const displayThreshold = metric === "temperature" ? threshold.toFixed(1) : threshold.toFixed(1);
  return {
    id: makeId("alert"),
    deviceId: record.deviceId,
    ownerUid: recordOwnerUid(record),
    type: "threshold",
    severity: direction === "high" ? "warning" : "danger",
    metric,
    direction,
    value,
    threshold,
    unit,
    title: `${label} ${comparison} nguong`,
    message: `${label} ${displayValue}${unit} ${comparison} nguong ${displayThreshold}${unit}.`,
    timestamp: new Date().toISOString(),
    unread: true,
    cooldownKey: `${recordOwnerUid(record)}:${record.deviceId}:${metric}:${direction}`,
    telegram: { configured: config.telegramConfigured, sent: false }
  };
}

async function deliverAndPersistAlert(alert, bypassTelegram = false, telegramOptions = {}) {
  const ownerUid = cleanText(alert.ownerUid || alert.requestedBy || "", 128);
  const ownerSettings = settingsForUid(ownerUid);
  const deliveryOptions = ownerUid && !telegramOptions.onlyUid
    ? { ...telegramOptions, onlyUid: ownerUid }
    : telegramOptions;
  if (ownerSettings.telegramEnabled && !bypassTelegram) {
    alert.telegram = await sendTelegram(
      `AQUA IoT CẢNH BÁO\nHồ: ${cleanText(ownerSettings.pondName || "Hồ cá chính", 80)}\n` +
      `${alert.message}\nThiết bị: ${alert.deviceId}\nLúc: ${new Date(alert.timestamp).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`,
      deliveryOptions
    );
  } else if (!ownerSettings.telegramEnabled) {
    alert.telegram = { configured: config.telegramConfigured, sent: false, reason: "TELEGRAM_DISABLED" };
  }
  await persistAlert(alert);
  return alert;
}

async function evaluateThresholds(record) {
  const settings = settingsForUid(recordOwnerUid(record));
  const candidates = [];
  if (record.temperature !== null) {
    if (record.temperature < settings.tempMin) {
      candidates.push(alertCandidate(record, "temperature", "low", record.temperature, settings.tempMin, " C"));
    } else if (record.temperature > settings.tempMax) {
      candidates.push(alertCandidate(record, "temperature", "high", record.temperature, settings.tempMax, " C"));
    }
  }
  // Never infer pH from voltage. Only calibrated/explicit pH values may trigger an alert.
  if (record.ph !== null && record.phCalibrated) {
    if (record.ph < settings.phMin) {
      candidates.push(alertCandidate(record, "ph", "low", record.ph, settings.phMin, " pH"));
    } else if (record.ph > settings.phMax) {
      candidates.push(alertCandidate(record, "ph", "high", record.ph, settings.phMax, " pH"));
    }
  }

  const created = [];
  const now = Date.now();
  const cooldown = finiteNumber(settings.alertCooldownMs, { min: 10000, max: 86400000 }) || config.alertCooldownMs;
  for (const alert of candidates) {
    const lastAt = runtime.lastAlertAtByKey.get(alert.cooldownKey) || 0;
    if (now - lastAt < cooldown) continue;
    runtime.lastAlertAtByKey.set(alert.cooldownKey, now);
    created.push(await deliverAndPersistAlert(alert));
  }
  return created;
}

async function ingestTelemetry(raw) {
  const record = normalizeTelemetry(raw);
  await registerDeviceSeen(record.deviceId, record.receivedAt);
  // Never trust ownerUid from a message received through a public broker.
  // Device ownership comes from the backend registry, never from MQTT JSON.
  record.ownerUid = deviceOwnerForId(record.deviceId) || "unassigned";
  runtime.latest = record;
  localState.latest = record;
  const lastSaved = runtime.lastSavedAtByDevice.get(record.deviceId) || 0;
  const shouldStore = record.timestampMs - lastSaved >= config.cloudSaveIntervalMs || lastSaved === 0;
  let cloudStored = false;

  if (shouldStore) {
    // Reserve the interval before awaiting I/O so concurrent MQTT packets remain throttled.
    runtime.lastSavedAtByDevice.set(record.deviceId, record.timestampMs);
    cloudStored = await storeTelemetry(record);
  }
  const alerts = await evaluateThresholds(record);
  const publicRecord = clonePublic(record);
  return {
    // Keep telemetry fields at the top level so existing Node-RED dashboard
    // function nodes can continue reading d.temperature/d.phRaw directly.
    ...publicRecord,
    ok: true,
    telemetry: publicRecord,
    stored: shouldStore,
    cloudStored,
    persistence: runtime.firestore ? (cloudStored ? "firestore+local" : "local-fallback") : "local",
    alerts: clonePublic(alerts)
  };
}

function setMqttStatus(status) {
  const now = new Date().toISOString();
  let online;
  let value;
  let message = "";
  let deviceId = "";
  if (Buffer.isBuffer(status)) status = status.toString("utf8");
  if (status && typeof status === "object") {
    try { deviceId = normalizeDeviceId(status.deviceId || "", false); } catch (_) { deviceId = ""; }
    const explicitOnline = status.online ?? status.connected;
    const statusText = cleanText(status.value ?? status.status ?? "", 40).toLowerCase();
    online = explicitOnline === undefined
      ? ["online", "connected", "true", "1"].includes(statusText)
      : parseBoolean(explicitOnline, false);
    value = statusText || (online ? "online" : "offline");
    message = cleanText(status.message || "", 160);
  } else {
    value = cleanText(status || "unknown", 40).toLowerCase();
    online = ["online", "connected", "true", "1"].includes(value);
  }
  runtime.mqttStatus = { online, value, changedAt: now, message };
  localState.mqttStatus = runtime.mqttStatus;
  if (deviceId) {
    runtime.mqttStatusByDevice[deviceId] = runtime.mqttStatus;
    localState.mqttStatusByDevice[deviceId] = runtime.mqttStatus;
  }
  void persistLocal();
  return clonePublic(runtime.mqttStatus);
}


  return {
    ingestTelemetry, setMqttStatus, persistActivity, persistAlert,
    deliverAndPersistAlert
  };
}

module.exports = { createTelemetryService };
