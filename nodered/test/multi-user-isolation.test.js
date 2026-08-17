"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const testDataPath = path.join(os.tmpdir(), `aqua-multitenant-${process.pid}-${Date.now()}.json`);
process.env.AQUA_LOCAL_DATA_PATH = testDataPath;
process.env.AQUA_ALLOW_LOCAL_AUTH = "true";
process.env.AQUA_ALLOW_DEMO_AUTH = "true";
process.env.CLOUD_SAVE_INTERVAL_MS = "1000";
delete process.env.AQUA_DEVICE_OWNER_UID;
delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.TELEGRAM_BOT_TOKEN;

const service = require("../lib/aqua-services.js");

const owner = { uid: "owner-uid", email: "owner@example.com", name: "Owner", role: "user", demo: false };
const secondOwner = { uid: "second-owner-uid", email: "second@example.com", name: "Second", role: "user", demo: false };
const stranger = { uid: "stranger-uid", email: "stranger@example.com", name: "Stranger", role: "user", demo: false };
const internal = (principal, query = {}) => ({ internal: true, principal, query: { hours: 24, limit: 100, ...query } });
const DEVICE_A = "aqua-001122334455";
const DEVICE_B = "aqua-aabbccddeeff";

after(() => {
  const resolved = path.resolve(testDataPath);
  const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(temporaryRoot) && fs.existsSync(resolved)) fs.unlinkSync(resolved);
});

test("each seen Device ID can be claimed only once", async () => {
  const initialTimestamp = Date.now() - 2000;
  await service.ingestTelemetry({ deviceId: DEVICE_A, timestampMs: initialTimestamp, temperature: 27, relayStatus: "OFF" });
  await service.ingestTelemetry({ deviceId: DEVICE_B, timestampMs: initialTimestamp, temperature: 26, relayStatus: "OFF" });

  const first = await service.handleAction({ action: "claimDevice", deviceId: DEVICE_A }, internal(owner));
  const second = await service.handleAction({ action: "claimDevice", deviceId: DEVICE_B }, internal(secondOwner));
  assert.equal(first.statusCode, 200);
  assert.equal(first.response.device.deviceId, DEVICE_A);
  assert.equal(second.statusCode, 200);

  const duplicate = await service.handleAction({ action: "claimDevice", deviceId: DEVICE_A }, internal(stranger));
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.response.error, "DEVICE_ALREADY_CLAIMED");

  const unknown = await service.handleAction({ action: "claimDevice", deviceId: "aqua-ffffffffffff" }, internal(stranger));
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.response.error, "DEVICE_NOT_FOUND");
});

test("telemetry and dashboards are isolated by the claimed Device ID", async () => {
  await service.saveSettings({ tempMin: 10, tempMax: 20, phMin: 6, phMax: 9 }, owner);
  const nextTimestamp = Date.now();
  await service.ingestTelemetry({ deviceId: DEVICE_A, timestampMs: nextTimestamp, temperature: 28.5, phRaw: 600, relayStatus: "OFF" });
  await service.ingestTelemetry({ deviceId: DEVICE_B, timestampMs: nextTimestamp, temperature: 25.5, phRaw: 610, relayStatus: "ON" });

  const ownerDashboard = await service.getDashboard(internal(owner));
  const secondDashboard = await service.getDashboard(internal(secondOwner));
  const strangerDashboard = await service.getDashboard(internal(stranger));

  assert.equal(ownerDashboard.latest.deviceId, DEVICE_A);
  assert.equal(ownerDashboard.latest.temperature, 28.5);
  assert.ok(ownerDashboard.history.every(item => item.deviceId === DEVICE_A));
  assert.deepEqual(ownerDashboard.devices.map(item => item.deviceId), [DEVICE_A]);
  assert.equal(ownerDashboard.status.assigned, true);

  assert.equal(secondDashboard.latest.deviceId, DEVICE_B);
  assert.ok(secondDashboard.history.every(item => item.deviceId === DEVICE_B));
  assert.deepEqual(secondDashboard.devices.map(item => item.deviceId), [DEVICE_B]);

  assert.equal(strangerDashboard.latest, null);
  assert.deepEqual(strangerDashboard.history, []);
  assert.deepEqual(strangerDashboard.alerts, []);
  assert.deepEqual(strangerDashboard.devices, []);
  assert.equal(strangerDashboard.status.assigned, false);
});

test("relay commands are routed only to the account's own device topic", async () => {
  const denied = await service.handleAction({ action: "relay", command: "ON", deviceId: DEVICE_B }, internal(owner));
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.response.error, "DEVICE_ACCESS_FORBIDDEN");

  const allowed = await service.handleAction({ action: "relay", command: "ON", deviceId: DEVICE_A }, internal(owner));
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.response.command, "ON");
  assert.equal(allowed.mqtt.topic, `aqua-iot/nhom18-24127175-24127257/${DEVICE_A}/command`);
  assert.equal(JSON.parse(allowed.mqtt.payload).deviceId, DEVICE_A);
});
