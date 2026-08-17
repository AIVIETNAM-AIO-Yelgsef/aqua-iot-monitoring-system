"use strict";

const { createContext } = require("./context");
const { createDeviceService } = require("./devices");
const { createAuthService } = require("./auth");
const { createTelegramService } = require("./telegram");
const { createTelemetryService } = require("./telemetry");
const { createDashboardService } = require("./dashboard");
const { createChatbot } = require("./chatbot");
const { createActionService } = require("./actions");

const ctx = createContext();

const devices = createDeviceService(ctx);
Object.assign(ctx.api, devices);

const auth = createAuthService(ctx);
Object.assign(ctx.api, auth);

const telegram = createTelegramService(ctx);
Object.assign(ctx.api, {
  getTelegramStatus: telegram.status,
  sendTelegram: telegram.send,
  createTelegramLink: telegram.createLink,
  processTelegramUpdates: telegram.poll,
  disconnectTelegram: telegram.disconnect
});

const telemetry = createTelemetryService(ctx);
Object.assign(ctx.api, telemetry);

const dashboard = createDashboardService(ctx);
Object.assign(ctx.api, dashboard);

const chatbot = createChatbot(ctx);
Object.assign(ctx.api, {
  answerChat: chatbot.answer,
  normalizeChatHistory: chatbot.normalizeHistory,
  consumeChatQuota: chatbot.consumeQuota
});

const actions = createActionService(ctx);
Object.assign(ctx.api, actions);

telegram.startPolling();

function health() {
  const latest = ctx.runtime.latest || ctx.localState.latest;
  return {
    ok: true,
    serviceVersion: ctx.SERVICE_VERSION,
    serverTime: new Date().toISOString(),
    status: dashboard.deviceStatus(latest),
    features: ctx.publicFeatures(),
    assistant: chatbot.status()
  };
}

module.exports = Object.freeze({
  getPublicConfig: ctx.getPublicConfig,
  setMqttStatus: telemetry.setMqttStatus,
  ingestTelemetry: telemetry.ingestTelemetry,
  getDashboard: dashboard.getDashboard,
  handleAction: actions.handleAction,
  verifyRequest: auth.verifyRequest,
  getHistory: dashboard.readHistory,
  getProfile: dashboard.readProfile,
  getSettings: dashboard.readSettings,
  saveSettings: dashboard.saveSettings,
  getTelegramStatus: telegram.status,
  pollTelegram: telegram.poll,
  health
});
