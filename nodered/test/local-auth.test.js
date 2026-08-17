"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const testDataPath = path.join(os.tmpdir(), `aqua-local-auth-${process.pid}-${Date.now()}.json`);
process.env.AQUA_LOCAL_DATA_PATH = testDataPath;
process.env.AQUA_ALLOW_LOCAL_AUTH = "true";
process.env.AQUA_ALLOW_DEMO_AUTH = "true";
delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.TELEGRAM_BOT_TOKEN;

const service = require("../lib/aqua-services.js");

function request(accessToken) {
  return {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    query: {}
  };
}

after(() => {
  const resolved = path.resolve(testDataPath);
  const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(temporaryRoot) && fs.existsSync(resolved)) fs.unlinkSync(resolved);
});

test("local accounts use unique identities and isolated profiles", async () => {
  const alice = await service.handleAction({
    action: "authRegister",
    name: "Alice Local",
    email: "alice@example.com",
    password: "StrongPassA!"
  }, request());
  assert.equal(alice.statusCode, 201);
  assert.match(alice.response.user.uid, /^local-[a-f0-9]{24}$/);
  assert.notEqual(alice.response.user.uid, "demo");

  const bob = await service.handleAction({
    action: "authRegister",
    name: "Bob Local",
    email: "bob@example.com",
    password: "StrongPassB!"
  }, request());
  assert.equal(bob.statusCode, 201);
  assert.notEqual(bob.response.user.uid, alice.response.user.uid);

  const aliceDashboard = await service.getDashboard(request(alice.response.accessToken));
  const bobDashboard = await service.getDashboard(request(bob.response.accessToken));
  assert.equal(aliceDashboard.profile.name, "Alice Local");
  assert.equal(aliceDashboard.profile.email, "alice@example.com");
  assert.equal(bobDashboard.profile.name, "Bob Local");
  assert.equal(bobDashboard.profile.email, "bob@example.com");

  const updated = await service.handleAction({
    action: "profile",
    profile: { name: "Alice Updated", pondName: "Pond A" }
  }, request(alice.response.accessToken));
  assert.equal(updated.statusCode, 200);
  assert.equal((await service.getDashboard(request(alice.response.accessToken))).profile.name, "Alice Updated");
  assert.equal((await service.getDashboard(request(bob.response.accessToken))).profile.name, "Bob Local");

  const demoDashboard = await service.getDashboard(request());
  assert.equal(demoDashboard.profile.uid, "demo");
  assert.notEqual(demoDashboard.profile.name, "Alice Updated");
});

test("local login rejects invalid credentials and persists no plaintext secret", async () => {
  const wrong = await service.handleAction({
    action: "authLogin",
    email: "alice@example.com",
    password: "wrong-password"
  }, request());
  assert.equal(wrong.statusCode, 401);

  const duplicate = await service.handleAction({
    action: "authRegister",
    name: "Another Alice",
    email: "ALICE@example.com",
    password: "OtherPass!"
  }, request());
  assert.equal(duplicate.statusCode, 409);

  const login = await service.handleAction({
    action: "authLogin",
    email: "alice@example.com",
    password: "StrongPassA!"
  }, request());
  assert.equal(login.statusCode, 200);
  assert.equal(login.response.user.name, "Alice Updated");

  const persisted = fs.readFileSync(testDataPath, "utf8");
  assert.equal(persisted.includes("StrongPassA!"), false);
  assert.equal(persisted.includes(login.response.accessToken), false);

  const logout = await service.handleAction({ action: "authLogout" }, request(login.response.accessToken));
  assert.equal(logout.statusCode, 200);
  await assert.rejects(
    service.getDashboard(request(login.response.accessToken)),
    error => error && error.statusCode === 401
  );
});
