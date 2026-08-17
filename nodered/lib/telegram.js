"use strict";

const crypto = require("crypto");

function createTelegramService(ctx) {
  const {
    MAX_TELEGRAM_LINK_REQUESTS, TELEGRAM_LINK_PREFIX, boundedInteger,
    cleanText, config, finiteNumber, firestoreSet, localState, makeId,
    persistLocal, runtime, serviceError
  } = ctx;
  const persistActivity = (...args) => ctx.api.persistActivity(...args);

function telegramTokenHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function cleanupTelegramLinkRequests() {
  const now = Date.now();
  const requests = Object.entries(localState.telegramLinkRequests || {});
  for (const [tokenHash, request] of requests) {
    const expiresAt = new Date(request && request.expiresAt || 0).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) delete localState.telegramLinkRequests[tokenHash];
  }
  const remaining = Object.entries(localState.telegramLinkRequests || {})
    .sort((left, right) => new Date(left[1].createdAt || 0) - new Date(right[1].createdAt || 0));
  while (remaining.length > MAX_TELEGRAM_LINK_REQUESTS) {
    const [tokenHash] = remaining.shift();
    delete localState.telegramLinkRequests[tokenHash];
  }
}

function telegramSubscriptionFor(uid) {
  const key = cleanText(uid || "", 128);
  const subscription = key && localState.telegramSubscriptions[key];
  return subscription && subscription.active !== false ? subscription : null;
}

function publicTelegramStatus(principal) {
  cleanupTelegramLinkRequests();
  const uid = cleanText(principal && principal.uid || "demo", 128) || "demo";
  const subscription = telegramSubscriptionFor(uid);
  const pending = Object.values(localState.telegramLinkRequests || {})
    .filter(request => request && request.uid === uid)
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))[0] || null;
  const displayName = subscription
    ? cleanText(`${subscription.firstName || ""} ${subscription.lastName || ""}`, 160)
    : "";
  const chatId = subscription && String(subscription.chatId || "");
  return {
    configured: config.telegramConfigured,
    connected: Boolean(subscription),
    pending: Boolean(pending),
    pendingExpiresAt: pending ? pending.expiresAt : null,
    botUsername: runtime.telegramBot && runtime.telegramBot.username || null,
    account: subscription ? {
      username: subscription.username || null,
      displayName: displayName || subscription.username || "Telegram user",
      idHint: chatId ? `••••${chatId.slice(-4)}` : null,
      connectedAt: subscription.connectedAt
    } : null,
    polling: config.telegramConfigured && !runtime.telegramLastError,
    lastError: runtime.telegramLastError
  };
}

async function telegramApi(method, payload = {}, timeoutMs = 10000) {
  if (!config.telegramConfigured) {
    throw serviceError(503, "TELEGRAM_NOT_CONFIGURED", "Telegram Bot token chua duoc cau hinh.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      const error = serviceError(502, "TELEGRAM_API_FAILED", "Telegram Bot API tam thoi tu choi yeu cau.");
      error.telegramHttpStatus = response.status;
      error.telegramErrorCode = boundedInteger(result.error_code, response.status, 0, 999);
      throw error;
    }
    return result.result;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw serviceError(504, "TELEGRAM_TIMEOUT", "Telegram Bot API khong phan hoi kip thoi.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureTelegramBot() {
  if (runtime.telegramBot && runtime.telegramBot.username) return runtime.telegramBot;
  const bot = await telegramApi("getMe");
  const botId = cleanText(bot && bot.id, 80);
  const username = cleanText(bot && bot.username || "", 64);
  if (!/^\d{1,30}$/.test(botId) || !/^[A-Za-z0-9_]{5,64}$/.test(username)) {
    throw serviceError(502, "TELEGRAM_BOT_INVALID", "Bot Telegram khong co username hop le.");
  }
  if (localState.telegramBotId && localState.telegramBotId !== botId) {
    // Update IDs and previous subscriptions belong to the old bot. Require a
    // fresh explicit Start so a replacement token cannot inherit recipients.
    localState.telegramUpdateOffset = 0;
    localState.telegramLinkRequests = {};
    localState.telegramSubscriptions = {};
  }
  if (localState.telegramBotId !== botId) {
    localState.telegramBotId = botId;
    await persistLocal();
  }
  runtime.telegramBot = {
    id: botId,
    username,
    name: cleanText(bot.first_name || username, 100)
  };
  return runtime.telegramBot;
}

async function sendTelegramToChat(chatId, text) {
  try {
    const message = await telegramApi("sendMessage", {
      chat_id: chatId,
      text: cleanText(text, 3500),
      disable_web_page_preview: true
    });
    return {
      sent: true,
      messageId: finiteNumber(message && message.message_id, { min: 0 })
    };
  } catch (error) {
    return {
      sent: false,
      reason: cleanText(error && error.code || "TELEGRAM_REQUEST_FAILED", 80),
      deactivate: Number(error && (error.telegramErrorCode || error.telegramHttpStatus)) === 403
    };
  }
}

function telegramRecipients(onlyUid) {
  const recipients = [];
  const add = (chatId, uid, legacy = false) => {
    const normalized = cleanText(chatId, 80);
    if (!/^-?\d{1,30}$/.test(normalized) || recipients.some(item => item.chatId === normalized)) return;
    recipients.push({ chatId: normalized, uid, legacy });
  };
  if (onlyUid) {
    const subscription = telegramSubscriptionFor(onlyUid);
    if (subscription) add(subscription.chatId, onlyUid, false);
    return recipients;
  }
  for (const [uid, subscription] of Object.entries(localState.telegramSubscriptions || {})) {
    if (subscription && subscription.active !== false) add(subscription.chatId, uid, false);
  }
  if (config.telegramLegacyChatId) add(config.telegramLegacyChatId, null, true);
  return recipients;
}

async function sendTelegram(text, options = {}) {
  if (!config.telegramConfigured) {
    return { configured: false, sent: false, reason: "TELEGRAM_NOT_CONFIGURED", delivered: 0, failed: 0 };
  }
  const recipients = telegramRecipients(cleanText(options.onlyUid || "", 128));
  if (!recipients.length) {
    return { configured: true, sent: false, reason: "TELEGRAM_NO_SUBSCRIBER", delivered: 0, failed: 0 };
  }
  let delivered = 0;
  let failed = 0;
  let stateChanged = false;
  for (const recipient of recipients) {
    const result = await sendTelegramToChat(recipient.chatId, text);
    if (result.sent) {
      delivered += 1;
    } else {
      failed += 1;
      if (result.deactivate && recipient.uid && localState.telegramSubscriptions[recipient.uid]) {
        localState.telegramSubscriptions[recipient.uid].active = false;
        localState.telegramSubscriptions[recipient.uid].updatedAt = new Date().toISOString();
        stateChanged = true;
      }
    }
  }
  if (stateChanged) await persistLocal();
  return {
    configured: true,
    sent: delivered > 0,
    delivered,
    failed,
    recipientCount: recipients.length,
    reason: delivered > 0 ? null : "TELEGRAM_DELIVERY_FAILED"
  };
}

async function createTelegramLink(principal) {
  if (!config.telegramConfigured) {
    throw serviceError(503, "TELEGRAM_NOT_CONFIGURED", "Hay dien TELEGRAM_BOT_TOKEN va khoi dong lai he thong.");
  }
  const bot = await ensureTelegramBot();
  const uid = cleanText(principal && principal.uid || "demo", 128) || "demo";
  cleanupTelegramLinkRequests();
  for (const [tokenHash, request] of Object.entries(localState.telegramLinkRequests || {})) {
    if (request && request.uid === uid) delete localState.telegramLinkRequests[tokenHash];
  }
  const parameter = `${TELEGRAM_LINK_PREFIX}${crypto.randomBytes(18).toString("base64url")}`;
  const now = Date.now();
  const expiresAt = new Date(now + config.telegramLinkTtlMs).toISOString();
  localState.telegramLinkRequests[telegramTokenHash(parameter)] = {
    uid,
    createdAt: new Date(now).toISOString(),
    expiresAt
  };
  cleanupTelegramLinkRequests();
  await persistLocal();
  await persistActivity({
    id: makeId("telegram-link"),
    type: "telegram-link-requested",
    requestedBy: uid,
    timestamp: new Date().toISOString()
  });
  startTelegramPolling();
  return {
    ...publicTelegramStatus(principal),
    pending: true,
    pendingExpiresAt: expiresAt,
    deepLink: `https://t.me/${bot.username}?start=${parameter}`
  };
}

async function completeTelegramLink(message, parameter) {
  const tokenHash = telegramTokenHash(parameter);
  const request = localState.telegramLinkRequests[tokenHash];
  if (!request || new Date(request.expiresAt || 0).getTime() <= Date.now()) return false;
  if (!message || message.chat && message.chat.type !== "private") return false;
  const chatId = cleanText(message.chat && message.chat.id, 80);
  const telegramUserId = cleanText(message.from && message.from.id, 80);
  if (!/^-?\d{1,30}$/.test(chatId) || !/^\d{1,30}$/.test(telegramUserId)) return false;

  const uid = cleanText(request.uid, 128);
  const now = new Date().toISOString();
  for (const [otherUid, subscription] of Object.entries(localState.telegramSubscriptions || {})) {
    if (otherUid !== uid && subscription && subscription.chatId === chatId) {
      delete localState.telegramSubscriptions[otherUid];
    }
  }
  localState.telegramSubscriptions[uid] = {
    uid,
    chatId,
    telegramUserId,
    username: cleanText(message.from && message.from.username || "", 64),
    firstName: cleanText(message.from && message.from.first_name || "", 100),
    lastName: cleanText(message.from && message.from.last_name || "", 100),
    active: true,
    connectedAt: now,
    updatedAt: now
  };
  delete localState.telegramLinkRequests[tokenHash];
  await persistLocal();
  if (runtime.firestore && uid !== "demo") {
    const subscription = localState.telegramSubscriptions[uid];
    await firestoreSet(config.collections.profiles, uid, {
      telegram: {
        connected: true,
        chatId: subscription.chatId,
        telegramUserId: subscription.telegramUserId,
        username: subscription.username || null,
        connectedAt: new Date(now),
        updatedAt: new Date(now)
      }
    }, true);
  }
  await persistActivity({
    id: makeId("telegram-connected"),
    type: "telegram-connected",
    requestedBy: uid,
    timestamp: now
  });
  await sendTelegramToChat(chatId,
    "Aqua IoT đã kết nối thành công. Bạn sẽ nhận cảnh báo của hồ cá tại đây. " +
    "Bạn có thể hủy liên kết bất kỳ lúc nào trên website."
  );
  return true;
}

async function processTelegramUpdates() {
  if (!config.telegramConfigured || runtime.telegramPolling) return;
  runtime.telegramPolling = true;
  try {
    cleanupTelegramLinkRequests();
    // Poll only while at least one web account is waiting for Start. Existing
    // subscribers receive outgoing alerts and do not require continuous reads.
    if (!Object.keys(localState.telegramLinkRequests || {}).length) {
      runtime.telegramLastError = null;
      return;
    }
    await ensureTelegramBot();
    const updates = await telegramApi("getUpdates", {
      offset: boundedInteger(localState.telegramUpdateOffset, 0, 0, Number.MAX_SAFE_INTEGER),
      limit: 100,
      timeout: 0,
      allowed_updates: ["message"]
    }, 12000);
    let nextOffset = localState.telegramUpdateOffset || 0;
    for (const update of Array.isArray(updates) ? updates : []) {
      const updateId = boundedInteger(update && update.update_id, -1, -1, Number.MAX_SAFE_INTEGER);
      if (updateId >= 0) nextOffset = Math.max(nextOffset, updateId + 1);
      const message = update && update.message;
      const text = cleanText(message && message.text || "", 200);
      const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+(aqua_[A-Za-z0-9_-]{12,60})$/i);
      if (match) await completeTelegramLink(message, match[1]);
    }
    if (nextOffset !== localState.telegramUpdateOffset) {
      localState.telegramUpdateOffset = nextOffset;
      await persistLocal();
    }
    runtime.telegramLastPollAt = new Date().toISOString();
    runtime.telegramLastError = null;
  } catch (error) {
    runtime.telegramLastError = cleanText(error && error.code || "TELEGRAM_POLL_FAILED", 80);
  } finally {
    runtime.telegramPolling = false;
  }
}

function startTelegramPolling() {
  if (!config.telegramConfigured || runtime.telegramPollTimer) return;
  const run = () => processTelegramUpdates().catch(() => undefined);
  const firstRun = setTimeout(run, 250);
  if (typeof firstRun.unref === "function") firstRun.unref();
  runtime.telegramPollTimer = setInterval(run, config.telegramPollIntervalMs);
  if (typeof runtime.telegramPollTimer.unref === "function") runtime.telegramPollTimer.unref();
}

async function disconnectTelegram(principal) {
  const uid = cleanText(principal && principal.uid || "demo", 128) || "demo";
  const subscription = telegramSubscriptionFor(uid);
  if (subscription) {
    await sendTelegramToChat(subscription.chatId, "Aqua IoT đã hủy liên kết thông báo theo yêu cầu của bạn.");
  }
  delete localState.telegramSubscriptions[uid];
  for (const [tokenHash, request] of Object.entries(localState.telegramLinkRequests || {})) {
    if (request && request.uid === uid) delete localState.telegramLinkRequests[tokenHash];
  }
  const now = new Date().toISOString();
  await persistLocal();
  if (runtime.firestore && uid !== "demo") {
    await firestoreSet(config.collections.profiles, uid, {
      telegram: {
        connected: false,
        chatId: null,
        telegramUserId: null,
        username: null,
        disconnectedAt: new Date(now),
        updatedAt: new Date(now)
      }
    }, true);
  }
  await persistActivity({
    id: makeId("telegram-disconnected"),
    type: "telegram-disconnected",
    requestedBy: uid,
    timestamp: now
  });
  return publicTelegramStatus(principal);
}


  return {
    status: publicTelegramStatus,
    send: sendTelegram,
    createLink: createTelegramLink,
    disconnect: disconnectTelegram,
    poll: processTelegramUpdates,
    startPolling: startTelegramPolling
  };
}

module.exports = { createTelegramService };
