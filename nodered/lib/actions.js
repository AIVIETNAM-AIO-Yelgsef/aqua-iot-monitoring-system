"use strict";

function createActionService(ctx) {
  const { api } = ctx;

  function parseBody(body) {
    if (Buffer.isBuffer(body)) body = body.toString("utf8");
    if (typeof body === "string") {
      if (Buffer.byteLength(body, "utf8") > 65536) {
        throw ctx.serviceError(413, "BODY_TOO_LARGE", "Noi dung yeu cau vuot qua gioi han.");
      }
      try {
        body = JSON.parse(body);
      } catch (_) {
        throw ctx.serviceError(400, "BODY_INVALID_JSON", "Noi dung JSON khong hop le.");
      }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw ctx.serviceError(400, "BODY_INVALID", "Noi dung yeu cau phai la JSON object.");
    }
    return body;
  }

  function result(statusCode, response, mqtt) {
    return mqtt ? { statusCode, response, mqtt } : { statusCode, response };
  }

  function mqttResult(deviceId, payload) {
    return {
      topic: ctx.mqttTopic(deviceId, "command"),
      payload: JSON.stringify(payload),
      qos: 1,
      retain: false
    };
  }

  async function authRegister(input) {
    const auth = await api.registerLocalAccount(input);
    return result(201, { ok: true, action: "authRegister", ...auth });
  }

  async function authLogin(input) {
    const auth = await api.loginLocalAccount(input);
    return result(200, { ok: true, action: "authLogin", ...auth });
  }

  async function authSession(_input, _principal, req) {
    if (ctx.runtime.firebaseAuth || !ctx.config.allowLocalAuth) {
      throw ctx.serviceError(409, "LOCAL_AUTH_UNAVAILABLE", "Phien tai khoan cuc bo khong kha dung.");
    }
    const user = api.localPrincipalFromRequest(req);
    if (!user) {
      throw ctx.serviceError(401, "AUTH_INVALID", "Phien dang nhap cuc bo khong hop le hoac da het han.");
    }
    return result(200, {
      ok: true,
      action: "authSession",
      user: api.localAccountPublic(ctx.localState.localAccounts[user.uid])
    });
  }

  async function authLogout(_input, _principal, req) {
    await api.logoutLocalAccount(req);
    return result(200, { ok: true, action: "authLogout" });
  }

  async function claimDevice(input, principal) {
    const device = await api.claimDevice(input.deviceId ?? input.code, principal);
    return result(200, {
      ok: true,
      action: "claimDevice",
      device,
      message: "Da lien ket thiet bi voi tai khoan."
    });
  }

  async function relay(input, principal) {
    const on = ctx.relayState(input.state ?? input.command ?? input.value ?? input.on);
    if (on === null) {
      throw ctx.serviceError(422, "RELAY_STATE_INVALID", "Trang thai relay phai la ON hoac OFF.");
    }
    const mode = ctx.controlMode(input.mode, "MANUAL", true);
    const deviceId = ctx.resolveDeviceForPrincipal(principal, input.deviceId);
    const requestId = ctx.makeId("web");
    const payload = { deviceId, command: on ? "ON" : "OFF", mode, requestId };
    await api.persistActivity({
      id: requestId,
      type: "relay-command",
      deviceId,
      command: payload.command,
      mode,
      requestedBy: principal.uid,
      timestamp: new Date().toISOString()
    });
    return result(200, {
      ok: true,
      action: "relay",
      command: payload.command,
      mode,
      requestId,
      message: `Da gui lenh ${on ? "BAT" : "TAT"} relay.`
    }, mqttResult(deviceId, payload));
  }

  async function mode(input, principal) {
    const selectedMode = ctx.controlMode(input.mode ?? input.value, "MANUAL", true);
    const deviceId = ctx.resolveDeviceForPrincipal(principal, input.deviceId);
    const requestId = ctx.makeId("web-mode");
    const settings = await api.saveSettings({ mode: selectedMode }, principal);
    const payload = { deviceId, command: "MODE", mode: selectedMode, requestId };
    await api.persistActivity({
      id: requestId,
      type: "mode-command",
      deviceId,
      command: "MODE",
      mode: selectedMode,
      requestedBy: principal.uid,
      timestamp: new Date().toISOString()
    });
    return result(200, {
      ok: true,
      action: "mode",
      mode: selectedMode,
      requestId,
      settings,
      message: `Da chuyen che do dieu khien sang ${selectedMode}.`
    }, mqttResult(deviceId, payload));
  }

  async function settings(input, principal) {
    const saved = await api.saveSettings(input.settings || input, principal);
    return result(200, { ok: true, action: "settings", settings: saved });
  }

  async function profile(input, principal) {
    const saved = await api.saveProfile(input.profile || input, principal);
    return result(200, { ok: true, action: "profile", profile: saved });
  }

  async function telegramConnect(_input, principal) {
    const telegram = await api.createTelegramLink(principal);
    return result(200, {
      ok: true,
      action: "telegramConnect",
      telegram,
      message: "Da tao lien ket. Hay mo Telegram va bam Start trong vong 10 phut."
    });
  }

  async function telegramStatus(_input, principal) {
    await api.processTelegramUpdates();
    return result(200, {
      ok: true,
      action: "telegramStatus",
      telegram: api.getTelegramStatus(principal)
    });
  }

  async function telegramDisconnect(_input, principal) {
    const telegram = await api.disconnectTelegram(principal);
    return result(200, {
      ok: true,
      action: "telegramDisconnect",
      telegram,
      message: "Da huy lien ket Telegram."
    });
  }

  async function chat(input, principal) {
    const question = ctx.cleanText(input.message ?? input.question, ctx.MAX_CHAT_MESSAGE_LENGTH);
    if (question.length < 2) {
      throw ctx.serviceError(422, "CHAT_MESSAGE_INVALID", "Cau hoi can it nhat 2 ky tu.");
    }
    const history = api.normalizeChatHistory(input.history);
    api.consumeChatQuota(principal);
    const answer = await api.answerChat(question, principal, history);
    return result(200, { ok: true, action: "chat", ...answer });
  }

  async function testAlert(input, principal) {
    const deviceId = input.deviceId
      ? ctx.resolveDeviceForPrincipal(principal, input.deviceId)
      : (ctx.deviceIdsForPrincipal(principal)[0] || "account");
    const alert = {
      id: ctx.makeId("alert-test"),
      deviceId,
      ownerUid: principal.uid,
      type: "test",
      severity: "info",
      metric: "system",
      direction: "test",
      value: null,
      threshold: null,
      unit: "",
      title: "Kiem tra canh bao Aqua IoT",
      message: "Day la thong bao kiem tra duoc gui tu website quan ly.",
      timestamp: new Date().toISOString(),
      unread: true,
      cooldownKey: `test:${principal.uid}`,
      requestedBy: principal.uid,
      telegram: { configured: ctx.config.telegramConfigured, sent: false }
    };
    const saved = await api.deliverAndPersistAlert(alert, false, { onlyUid: principal.uid });
    const delivery = saved.telegram || {};
    const message = delivery.sent
      ? `Da gui canh bao thu den ${delivery.delivered || 1} tai khoan Telegram.`
      : delivery.reason === "TELEGRAM_NO_SUBSCRIBER"
        ? "Tai khoan web chua lien ket Telegram."
        : "Canh bao da duoc luu nhung Telegram chua gui thanh cong.";
    return result(200, {
      ok: true,
      action: "testAlert",
      alert: ctx.clonePublic(saved),
      message
    });
  }

  const publicHandlers = {
    authregister: authRegister,
    authlogin: authLogin,
    authsession: authSession,
    authlogout: authLogout
  };

  const protectedHandlers = {
    claimdevice: { write: true, run: claimDevice },
    relay: { write: true, run: relay },
    mode: { write: true, run: mode },
    settings: { write: true, run: settings },
    profile: { write: true, run: profile },
    telegramconnect: { write: false, run: telegramConnect },
    telegramstatus: { write: false, run: telegramStatus },
    telegramdisconnect: { write: false, run: telegramDisconnect },
    chat: { write: false, run: chat },
    testalert: { write: true, run: testAlert }
  };

  function actionName(input) {
    const name = ctx.cleanText(input.action, 40).toLowerCase().replace(/-/g, "");
    if (!name) throw ctx.serviceError(400, "ACTION_REQUIRED", "Thieu action.");
    return name;
  }

  function errorResult(error) {
    const statusCode = ctx.boundedInteger(error && error.statusCode, 500, 400, 599);
    return result(statusCode, {
      ok: false,
      error: ctx.cleanText(error && error.code || "SERVICE_ERROR", 80),
      message: statusCode >= 500
        ? "Backend tam thoi khong xu ly duoc yeu cau."
        : ctx.cleanText(error && error.message || "Yeu cau khong hop le.", 240)
    });
  }

  async function handleAction(body, req) {
    try {
      const input = parseBody(body);
      const name = actionName(input);
      if (publicHandlers[name]) return await publicHandlers[name](input, null, req);

      const handler = protectedHandlers[name];
      if (!handler) throw ctx.serviceError(400, "ACTION_UNKNOWN", "Action khong duoc ho tro.");

      const principal = await api.verifyRequest(req);
      if (handler.write && principal.role === "viewer") {
        throw ctx.serviceError(403, "ACTION_FORBIDDEN", "Tai khoan chi co quyen xem.");
      }
      return await handler.run(input, principal, req);
    } catch (error) {
      return errorResult(error);
    }
  }

  return { handleAction };
}

module.exports = { createActionService };

