"use strict";

const crypto = require("crypto");

function createTelegramService({ state, saveLocal, text, pollInterval, linkTtl }) {
  function status(user) {
    const subscription = state.telegramSubscriptions[user.uid];
    const pending = Object.values(state.telegramLinkRequests)
      .find(item => item.uid === user.uid && Date.parse(item.expiresAt) > Date.now());
    return {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      connected: Boolean(subscription && subscription.active !== false),
      pending: Boolean(pending),
      pendingExpiresAt: pending?.expiresAt || null,
      account: subscription ? {
        username: subscription.username || null,
        displayName: subscription.displayName || subscription.username || "Telegram user",
        idHint: `....${String(subscription.chatId).slice(-4)}`,
        connectedAt: subscription.connectedAt
      } : null
    };
  }

  async function api(method, body) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("Telegram Bot token chua duoc cau hinh.");
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error("Telegram Bot API tam thoi tu choi yeu cau.");
    return data.result;
  }

  async function send(message) {
    if (!process.env.TELEGRAM_BOT_TOKEN) return { configured: false, sent: false, delivered: 0 };
    const recipients = new Set(Object.values(state.telegramSubscriptions)
      .filter(item => item?.active !== false && /^-?\d{1,30}$/.test(String(item.chatId)))
      .map(item => String(item.chatId)));
    if (process.env.TELEGRAM_CHAT_ID) recipients.add(process.env.TELEGRAM_CHAT_ID);
    let delivered = 0;
    for (const chatId of recipients) {
      try {
        await api("sendMessage", { chat_id: chatId, text: text(message, 3500), disable_web_page_preview: true });
        delivered += 1;
      } catch (_) { /* Keep delivering to other opted-in recipients. */ }
    }
    return { configured: true, sent: delivered > 0, delivered, recipientCount: recipients.size };
  }

  async function createLink(user) {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      const error = new Error("Hay dien TELEGRAM_BOT_TOKEN va khoi dong lai he thong.");
      error.statusCode = 503;
      throw error;
    }
    const bot = await api("getMe", {});
    if (!/^[A-Za-z0-9_]{5,64}$/.test(String(bot?.username || ""))) throw new Error("Bot Telegram khong co username hop le.");
    const parameter = `aqua_${crypto.randomBytes(18).toString("base64url")}`;
    const tokenHash = crypto.createHash("sha256").update(parameter).digest("hex");
    for (const [key, item] of Object.entries(state.telegramLinkRequests)) {
      if (item.uid === user.uid || Date.parse(item.expiresAt) <= Date.now()) delete state.telegramLinkRequests[key];
    }
    const expiresAt = new Date(Date.now() + linkTtl).toISOString();
    state.telegramLinkRequests[tokenHash] = { uid: user.uid, expiresAt };
    saveLocal();
    return { ...status(user), pending: true, pendingExpiresAt: expiresAt, deepLink: `https://t.me/${bot.username}?start=${parameter}` };
  }

  async function disconnect(user) {
    delete state.telegramSubscriptions[user.uid];
    for (const [key, item] of Object.entries(state.telegramLinkRequests)) if (item.uid === user.uid) delete state.telegramLinkRequests[key];
    saveLocal();
    return status(user);
  }

  async function poll() {
    if (!process.env.TELEGRAM_BOT_TOKEN || !Object.keys(state.telegramLinkRequests).length) return;
    try {
      const updates = await api("getUpdates", { offset: state.telegramUpdateOffset, timeout: 0, allowed_updates: ["message"] });
      for (const update of updates || []) {
        state.telegramUpdateOffset = Math.max(state.telegramUpdateOffset, Number(update.update_id || -1) + 1);
        const message = update.message;
        const match = String(message?.text || "").match(/^\/start\s+(aqua_[A-Za-z0-9_-]{12,80})$/i);
        if (!match || message?.chat?.type !== "private") continue;
        const key = crypto.createHash("sha256").update(match[1]).digest("hex");
        const request = state.telegramLinkRequests[key];
        if (!request || Date.parse(request.expiresAt) <= Date.now()) continue;
        state.telegramSubscriptions[request.uid] = {
          chatId: String(message.chat.id), username: text(message.from?.username, 64),
          displayName: text(`${message.from?.first_name || ""} ${message.from?.last_name || ""}`, 100),
          active: true, connectedAt: new Date().toISOString()
        };
        delete state.telegramLinkRequests[key];
        await api("sendMessage", { chat_id: message.chat.id, text: "Aqua IoT da ket noi thanh cong. Ban se nhan canh bao tai day." });
      }
      saveLocal();
    } catch (_) { /* The interval retries transient Telegram failures. */ }
  }

  const timer = setInterval(poll, pollInterval);
  if (typeof timer.unref === "function") timer.unref();
  return { status, send, createLink, disconnect, poll };
}

module.exports = { createTelegramService };
