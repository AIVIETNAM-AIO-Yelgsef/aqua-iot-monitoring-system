(() => {
  "use strict";

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const api = window.AquaAPI;
  const HOUR = 60 * 60 * 1000;
  const STORAGE = {
    accounts: "aqua_iot_demo_accounts",
    session: "aqua_iot_demo_session",
    aerator: "aqua_iot_aerator_state",
    thresholds: "aqua_iot_thresholds",
    alerts: "aqua_iot_demo_alerts",
    telegram: "aqua_iot_telegram_demo"
  };

  const pageTitles = {
    overview: "Tổng quan",
    monitoring: "Giám sát trực tiếp",
    history: "Lịch sử dữ liệu",
    devices: "Thiết bị",
    alerts: "Cảnh báo",
    assistant: "Trợ lý AI",
    settings: "Cài đặt & dự án"
  };

  const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const tableDateFormatter = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const timeFormatter = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit"
  });
  const shortDateFormatter = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit"
  });

  const storage = {
    get(key, fallback = null, session = false) {
      try {
        const raw = (session ? sessionStorage : localStorage).getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value, session = false) {
      try {
        (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value));
        return true;
      } catch (_) {
        return false;
      }
    },
    remove(key, session = false) {
      try { (session ? sessionStorage : localStorage).removeItem(key); } catch (_) { /* noop */ }
    }
  };

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function round(value, digits = 1) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }
  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }
  function sensorText(value, digits) {
    const number = finite(value);
    return number === null ? "--" : number.toFixed(digits);
  }
  function parseTimestamp(value) {
    if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  function pseudoRandom(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }
  function normalizeText(text) {
    return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  }
  function initials(name) {
    const parts = String(name || "Demo").trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
  }
  function firstName(name) {
    const parts = String(name || "bạn").trim().split(/\s+/).filter(Boolean);
    return parts[parts.length - 1] || "bạn";
  }
  function icon(name) { return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`; }
  function formatTableDate(timestamp) { return tableDateFormatter.format(new Date(timestamp)); }
  function formatTime(timestamp) { return timeFormatter.format(new Date(timestamp)); }
  function relativeTime(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return "Vừa xong";
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    const days = Math.floor(hours / 24);
    return `${days} ngày trước`;
  }

  function makeHistory() {
    const records = [];
    const end = Date.now();
    for (let hoursAgo = 719; hoursAgo >= 0; hoursAgo -= 1) {
      const index = 719 - hoursAgo;
      const daily = Math.sin((index % 24) / 24 * Math.PI * 2 - 1.1);
      const slow = Math.sin(index / 57);
      const noise = (pseudoRandom(index + 17) - 0.5);
      const temperature = 27.1 + daily * 0.55 + slow * 0.24 + noise * 0.18;
      const ph = 7.16 + Math.sin(index / 31 + 0.7) * 0.17 + (pseudoRandom(index + 91) - 0.5) * 0.08;
      records.push({
        timestamp: end - hoursAgo * HOUR,
        temperature: round(temperature, 1),
        ph: round(clamp(ph, 6.75, 7.55), 2)
      });
    }
    records[records.length - 1] = { timestamp: end, temperature: 27.4, ph: 7.2 };
    return records;
  }

  function makeLiveBuffer(current) {
    return Array.from({ length: 30 }, (_, index) => ({
      timestamp: Date.now() - (29 - index) * 5000,
      temperature: round(current.temperature + Math.sin(index / 4) * 0.12 + (pseudoRandom(index) - .5) * .06, 1),
      ph: round(current.ph + Math.cos(index / 5) * 0.025 + (pseudoRandom(index + 30) - .5) * .02, 2)
    }));
  }

  function defaultAlerts() {
    const now = Date.now();
    return [
      { id: "alert-ph-low", type: "danger", title: "pH thấp hơn ngưỡng demo", message: "Giá trị mô phỏng 6.3 pH · ngưỡng demo 6.5", timestamp: now - 2.4 * HOUR, unread: true, delivery: "Telegram mô phỏng" },
      { id: "alert-temp-high", type: "warning", title: "Nhiệt độ vượt ngưỡng demo", message: "Giá trị mô phỏng 30.6°C · ngưỡng demo 30.0°C", timestamp: now - 26 * HOUR, unread: true, delivery: "Telegram mô phỏng" },
      { id: "alert-ph-high", type: "warning", title: "pH cao hơn ngưỡng demo", message: "Giá trị mô phỏng 8.2 pH · ngưỡng demo 8.0", timestamp: now - 73 * HOUR, unread: false, delivery: "Telegram mô phỏng" }
    ];
  }

  const savedThresholds = storage.get(STORAGE.thresholds, null);
  const state = {
    currentPage: "overview",
    user: null,
    temperature: null,
    ph: null,
    phRaw: null,
    phVoltage: null,
    turbidityRaw: null,
    turbidityVoltage: null,
    latestPayload: null,
    lastUpdate: 0,
    aerator: false,
    mode: "MANUAL",
    aeratorPending: false,
    aeratorChangedAt: 0,
    history: [],
    liveBuffer: [],
    liveMetric: "both",
    historyHours: 24,
    historyMetric: "both",
    historyPage: 1,
    historySearch: "",
    thresholds: savedThresholds && validThresholdObject(savedThresholds) ? savedThresholds : { tempMin: 24, tempMax: 30, phMin: 6.5, phMax: 8 },
    alerts: [],
    telegram: false,
    status: { mqttConnected: false, deviceOnline: false, storage: "local" },
    features: {},
    profile: null,
    dashboardLoaded: false,
    polling: false,
    pendingAeratorValue: null,
    chartModels: new Map()
  };

  function validThresholdObject(value) {
    return value && ["tempMin", "tempMax", "phMin", "phMax"].every(key => Number.isFinite(Number(value[key]))) && Number(value.tempMin) < Number(value.tempMax) && Number(value.phMin) < Number(value.phMax);
  }

  function toast(title, message, type = "success", timeout = 3300) {
    const region = $("#toast-region");
    const element = document.createElement("div");
    const iconName = type === "warning" ? "alert" : type === "info" ? "info" : "check";
    element.className = `toast ${type}`;
    element.innerHTML = `<span>${icon(iconName)}</span><div><strong></strong><p></p></div><button type="button" aria-label="Đóng thông báo">${icon("x")}</button>`;
    $("strong", element).textContent = title;
    $("p", element).textContent = message;
    const close = () => {
      if (!element.isConnected) return;
      element.classList.add("out");
      setTimeout(() => element.remove(), 210);
    };
    $("button", element).addEventListener("click", close);
    region.appendChild(element);
    setTimeout(close, timeout);
  }

  async function hashPassword(password) {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      const data = new TextEncoder().encode(`aqua-demo:${password}`);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
    }
    let hash = 2166136261;
    const salted = `aqua-demo:${password}`;
    for (let i = 0; i < salted.length; i += 1) {
      hash ^= salted.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `fallback-${(hash >>> 0).toString(16)}`;
  }

  function getStoredSession() {
    return storage.get(STORAGE.session, null, true) || storage.get(STORAGE.session, null, false);
  }

  function saveSession(user, remember) {
    storage.remove(STORAGE.session, true);
    storage.remove(STORAGE.session, false);
    storage.set(STORAGE.session, user, !remember);
  }

  function renderUser() {
    const user = state.user || { name: "Người dùng Demo", email: "demo@aquaiot.local" };
    $$('[data-user-name]').forEach(element => { element.textContent = user.name; });
    $$('[data-user-initial]').forEach(element => { element.textContent = initials(user.name); });
    $$('[data-user-first-name]').forEach(element => { element.textContent = firstName(user.name); });
    $$('[data-account-mode]').forEach(element => { element.textContent = api.isFirebase ? "Firebase Auth" : "Tài khoản cục bộ"; });
    $("#profile-name").value = user.name;
    $("#profile-email").textContent = user.email;
    $("#profile-email-input").value = user.email;
  }

  function showApp(user) {
    state.user = user;
    $("#auth-screen").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
    renderUser();
    renderThresholds();
    renderAerator();
    renderAlerts();
    updateSensorDOM();
    navigate(state.currentPage, false);
    refreshDashboard(true);
    setTimeout(renderActivePage, 40);
  }

  function showAuth() {
    $("#app-shell").classList.add("hidden");
    $("#auth-screen").classList.remove("hidden");
    $("#login-form").reset();
    $("#login-form .password-toggle")?.setAttribute("aria-label", "Hiện mật khẩu");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function loginDemo() {
    try {
      const user = api.enterDemo();
      showApp(user);
      toast("Đã vào chế độ cục bộ", "Dữ liệu cảm biến và relay vẫn đi qua Node-RED/MQTT; Firebase Auth đang được bỏ qua.", "info", 4500);
    } catch (error) {
      toast("Không thể vào demo", error.message, "warning");
    }
  }

  function switchAuthTab(tabName) {
    $$('[data-auth-tab]').forEach(tab => {
      const active = tab.dataset.authTab === tabName;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $$('[data-auth-form]').forEach(form => form.classList.toggle("active", form.dataset.authForm === tabName));
  }

  function initAuth() {
    $$('[data-auth-tab]').forEach(tab => tab.addEventListener("click", () => switchAuthTab(tab.dataset.authTab)));
    $$(".password-toggle").forEach(button => button.addEventListener("click", () => {
      const input = $("input", button.closest(".input-wrap"));
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.setAttribute("aria-label", showing ? "Hiện mật khẩu" : "Ẩn mật khẩu");
    }));
    $("#demo-login").addEventListener("click", loginDemo);
    $("#forgot-password").addEventListener("click", async () => {
      const email = String($("#login-email").value || "").trim();
      if (!email) {
        toast("Thiếu email", "Nhập email trước khi yêu cầu đặt lại mật khẩu.", "warning");
        return;
      }
      try {
        await api.resetPassword(email);
        toast("Đã gửi email", "Hãy kiểm tra hộp thư để đặt lại mật khẩu Firebase.");
      } catch (error) { toast("Chưa gửi được email", error.message, "warning"); }
    });

    $("#login-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const email = String(form.get("email") || "").trim().toLowerCase();
      const password = String(form.get("password") || "");
      try {
        const user = await api.signIn(email, password, $("#remember-me").checked);
        showApp(user);
        toast("Đăng nhập thành công", api.isFirebase ? "Firebase đã xác thực tài khoản." : "Đang dùng phiên cục bộ của Node-RED.", "success");
      } catch (error) { toast("Không thể đăng nhập", error.message, "warning"); }
    });

    $("#register-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const name = String(form.get("name") || "").trim();
      const email = String(form.get("email") || "").trim().toLowerCase();
      const password = String(form.get("password") || "");
      if (name.length < 2 || password.length < 6) {
        toast("Thông tin chưa hợp lệ", "Tên cần từ 2 ký tự và mật khẩu từ 6 ký tự.", "warning");
        return;
      }
      try {
        const user = await api.register(name, email, password);
        showApp(user);
        toast("Tạo tài khoản thành công", api.isFirebase ? "Hồ sơ đã được liên kết với Firebase UID." : "Tài khoản cục bộ đã sẵn sàng.");
      } catch (error) { toast("Không thể tạo tài khoản", error.message, "warning"); }
    });
  }

  function openSidebar() {
    $("#sidebar").classList.add("open");
    $("#sidebar-overlay").classList.add("open");
  }
  function closeSidebar() {
    $("#sidebar").classList.remove("open");
    $("#sidebar-overlay").classList.remove("open");
  }

  function navigate(page, scroll = true) {
    if (!pageTitles[page]) return;
    state.currentPage = page;
    $$(".page-view").forEach(view => view.classList.toggle("active", view.dataset.view === page));
    $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.page === page));
    $("#page-title").textContent = pageTitles[page];
    $("#breadcrumb-page").textContent = pageTitles[page];
    $("#notification-popover").classList.remove("open");
    $("#notification-popover").setAttribute("aria-hidden", "true");
    try {
      const url = new URL(location.href);
      url.hash = page;
      window.history.replaceState(null, "", url);
    } catch (_) { /* file URL fallback */ }
    closeSidebar();
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(renderActivePage, 30);
  }

  function initNavigation() {
    $$('[data-page]').forEach(button => button.addEventListener("click", event => {
      const page = event.currentTarget.dataset.page;
      if (page) navigate(page);
    }));
    $("#menu-button").addEventListener("click", openSidebar);
    $("#sidebar-close").addEventListener("click", closeSidebar);
    $("#sidebar-overlay").addEventListener("click", closeSidebar);
    $("#logout-button").addEventListener("click", async () => {
      await api.signOut().catch(() => {});
      state.user = null;
      showAuth();
      toast("Đã đăng xuất", "Phiên truy cập đã kết thúc.", "info");
    });
  }

  function updateClock() {
    const now = new Date();
    $("#topbar-time").textContent = dateTimeFormatter.format(now);
    $("#overview-last-update").textContent = state.lastUpdate ? relativeTime(state.lastUpdate) : "Chưa có dữ liệu";
    $("#last-sync-top").textContent = state.lastUpdate ? `ESP32 cập nhật ${relativeTime(state.lastUpdate).toLowerCase()}` : "Đang chờ ESP32";
  }

  function updateThresholdLabels() {
    const { tempMin, tempMax, phMin, phMax } = state.thresholds;
    const tempLabel = `Ngưỡng: ${tempMin}–${tempMax}°C`;
    const phLabel = `Ngưỡng: ${phMin}–${phMax}`;
    const tempCardLabel = $(".temp-card .metric-footer > span");
    const phCardLabel = $(".ph-card .metric-footer > span");
    if (tempCardLabel) tempCardLabel.textContent = tempLabel;
    if (phCardLabel) phCardLabel.textContent = phLabel;
    const tempFocus = $(".temperature-focus .focus-copy p");
    const phFocus = $(".ph-focus .focus-copy p");
    if (tempFocus) tempFocus.innerHTML = `<i></i> Ngưỡng ${tempMin}–${tempMax}°C`;
    if (phFocus) phFocus.innerHTML = `<i></i> ${finite(state.ph) === null ? "Đầu dò pH chưa hiệu chuẩn" : `Ngưỡng ${phMin}–${phMax}`}`;
  }

  function updateSensorDOM() {
    $$('[data-temperature]').forEach(element => { element.textContent = sensorText(state.temperature, 1); });
    $$('[data-ph]').forEach(element => { element.textContent = finite(state.ph) === null ? "--" : sensorText(state.ph, 2).replace(/0$/, ""); });
    $$('[data-turbidity-raw]').forEach(element => { element.textContent = finite(state.turbidityRaw) === null ? "--" : Math.round(state.turbidityRaw); });
    const payload = state.latestPayload || {
      message: "Đang chờ ESP32 publish telemetry qua MQTT",
      temperature: null,
      ph: null
    };
    $("#mqtt-payload").textContent = JSON.stringify(payload, null, 2);
    const notice = $(".demo-notice");
    if (notice) notice.innerHTML = `<span class="status-dot"></span> ${state.status.deviceOnline ? "ESP32 đang trực tuyến" : "Đang chờ ESP32"} · ${state.status.mqttConnected ? "MQTT đã kết nối" : "MQTT chưa kết nối"}`;
    const badge = $(".demo-data-badge");
    if (badge) badge.innerHTML = `${icon("info")}<span><strong>${state.status.deviceOnline ? "Dữ liệu ESP32" : "Chưa có dữ liệu thật"}</strong><small>${state.status.storage === "firestore" ? "Lưu trên Firebase Firestore" : "Lưu cục bộ tại Node-RED"}</small></span>`;
    const setDeviceBadge = (name, active, activeText, inactiveText, off = false) => {
      const element = $(`[data-device-status="${name}"]`);
      if (!element) return;
      element.classList.toggle("offline", !active && !off);
      element.classList.toggle("off", off);
      element.innerHTML = `<i></i>${active ? activeText : inactiveText}`;
    };
    const espOnline = state.status.deviceOnline;
    const temperatureOnline = espOnline && finite(state.temperature) !== null;
    const phOnline = espOnline && [state.ph, state.phRaw, state.phVoltage].some(value => finite(value) !== null);
    const turbidityOnline = espOnline && [state.turbidityRaw, state.turbidityVoltage].some(value => finite(value) !== null);
    setDeviceBadge("esp32", espOnline, "Trực tuyến", "Ngoại tuyến");
    setDeviceBadge("temperature", temperatureOnline, "Hoạt động", espOnline ? "Không có dữ liệu" : "Ngoại tuyến");
    setDeviceBadge("ph", phOnline, "Hoạt động", espOnline ? "Không có dữ liệu" : "Ngoại tuyến");
    setDeviceBadge("turbidity", turbidityOnline, "Hoạt động", espOnline ? "Không có dữ liệu" : "Ngoại tuyến");
    setDeviceBadge("relay", espOnline && state.aerator, "Đang bật", espOnline ? "Đang tắt" : "Không xác định", espOnline && !state.aerator);
    const deviceSummary = $(".all-online");
    if (deviceSummary) {
      deviceSummary.classList.toggle("offline", !espOnline);
      deviceSummary.innerHTML = `<i></i>${espOnline ? "Đang nhận trạng thái từ ESP32" : "ESP32 đang ngoại tuyến"}`;
    }
    const connections = $$(".connection-list b");
    if (connections[0]) connections[0].innerHTML = `<i></i>${state.status.deviceOnline ? "Trực tuyến" : "Ngoại tuyến"}`;
    if (connections[1]) connections[1].innerHTML = `<i></i>${state.status.mqttConnected ? "Đã kết nối" : "Mất kết nối"}`;
    if (connections[2]) connections[2].innerHTML = `<i></i>${state.features.firestore ? "Đã kết nối" : "Kho cục bộ"}`;
    const tempOk = finite(state.temperature) !== null && state.temperature >= state.thresholds.tempMin && state.temperature <= state.thresholds.tempMax;
    const phKnown = finite(state.ph) !== null;
    const phOk = !phKnown || (state.ph >= state.thresholds.phMin && state.ph <= state.thresholds.phMax);
    const healthTitle = $(".health-copy h3");
    const healthDescription = $(".health-copy p");
    const healthLabel = $(".health-label");
    const score = $(".score-ring strong");
    if (healthLabel) healthLabel.textContent = state.status.deviceOnline ? "TRẠNG THÁI DỮ LIỆU THỜI GIAN THỰC" : "ĐANG CHỜ TELEMETRY";
    if (healthTitle) healthTitle.textContent = !state.status.deviceOnline ? "Chưa nhận dữ liệu từ hồ cá" : (tempOk && phOk ? "Các thông số khả dụng đang trong ngưỡng" : "Có thông số ngoài ngưỡng");
    if (healthDescription) healthDescription.textContent = !state.status.deviceOnline ? "Kiểm tra Wi‑Fi, địa chỉ MQTT broker và nguồn ESP32." : (!phKnown ? "Nhiệt độ lấy từ DS18B20; pH sẽ xuất hiện sau khi hiệu chuẩn." : "Đánh giá dựa trên ngưỡng bạn đã cấu hình.");
    if (score) score.textContent = !state.status.deviceOnline ? "--" : (tempOk && phOk ? "100" : "60");
    const tempStatus = $(".temp-card .good-status");
    const phStatus = $(".ph-card .good-status");
    if (tempStatus) tempStatus.innerHTML = `<i></i> ${finite(state.temperature) === null ? "Chưa có dữ liệu" : tempOk ? "Bình thường" : "Ngoài ngưỡng"}`;
    if (phStatus) phStatus.innerHTML = `<i></i> ${phKnown ? (phOk ? "Bình thường" : "Ngoài ngưỡng") : "Chưa hiệu chuẩn"}`;
    const cloudCard = $(".cloud-card");
    if (cloudCard) {
      const label = $(".metric-label", cloudCard);
      const strong = $(".device-state strong", cloudCard);
      const footer = $(".metric-footer b", cloudCard);
      if (label) label.textContent = "Lưu trữ dữ liệu";
      if (strong) strong.textContent = state.status.storage === "firestore" ? "Firestore đang hoạt động" : "Kho cục bộ đang hoạt động";
      if (footer) footer.innerHTML = `<i></i> ${state.status.storage === "firestore" ? "Cloud + local" : "Chờ cấu hình Cloud"}`;
    }
    updateClock();
  }

  function normalizeRecord(record = {}) {
    const relayValue = record.relayStatus ?? record.relayOn ?? record.relay;
    const relayStatus = typeof relayValue === "string"
      ? ["ON", "TRUE", "1", "BAT"].includes(relayValue.toUpperCase())
      : Boolean(relayValue);
    return {
      ...record,
      timestamp: parseTimestamp(record.timestamp || record.receivedAt || record.createdAt),
      temperature: finite(record.temperature),
      ph: finite(record.ph ?? record.pH),
      phRaw: finite(record.phRaw),
      phVoltage: finite(record.phVoltage),
      turbidityRaw: finite(record.turbidityRaw ?? record.turbidity),
      turbidityVoltage: finite(record.turbidityVoltage),
      relayStatus
    };
  }

  function applyDashboard(data = {}) {
    const latest = data.latest ? normalizeRecord(data.latest) : null;
    if (latest) {
      state.temperature = latest.temperature;
      state.ph = latest.ph;
      state.phRaw = latest.phRaw;
      state.phVoltage = latest.phVoltage;
      state.turbidityRaw = latest.turbidityRaw;
      state.turbidityVoltage = latest.turbidityVoltage;
      state.aerator = latest.relayStatus;
      state.mode = String(latest.controlMode || latest.mode || data.settings?.mode || state.mode).toUpperCase();
      state.lastUpdate = latest.timestamp;
      state.latestPayload = data.latest;
      const lastLive = state.liveBuffer[state.liveBuffer.length - 1];
      if (!lastLive || lastLive.timestamp !== latest.timestamp) {
        state.liveBuffer.push(latest);
        if (state.liveBuffer.length > 60) state.liveBuffer.shift();
      }
    }
    if (Array.isArray(data.history)) state.history = data.history.map(normalizeRecord).sort((a, b) => a.timestamp - b.timestamp);
    if (Array.isArray(data.alerts)) state.alerts = data.alerts.map(alert => ({ ...alert, timestamp: parseTimestamp(alert.timestamp || alert.createdAt), unread: alert.unread !== false }));
    if (data.settings) {
      const thresholds = data.settings.thresholds || data.settings;
      if (validThresholdObject(thresholds)) state.thresholds = {
        tempMin: Number(thresholds.tempMin), tempMax: Number(thresholds.tempMax),
        phMin: Number(thresholds.phMin), phMax: Number(thresholds.phMax)
      };
      if (typeof data.settings.telegramEnabled === "boolean") state.telegram = data.settings.telegramEnabled;
      if (data.settings.mode) state.mode = String(data.settings.mode).toUpperCase();
    }
    const backendStatus = data.status || {};
    state.status = {
      ...state.status,
      ...backendStatus,
      deviceOnline: Boolean(backendStatus.deviceOnline ?? backendStatus.online),
      mqttConnected: Boolean(backendStatus.mqttConnected ?? backendStatus.mqtt?.connected ?? backendStatus.mqtt?.online ?? backendStatus.online),
      storage: String(backendStatus.storage || backendStatus.persistence || state.status.storage).includes("firestore") ? "firestore" : "local"
    };
    state.features = { ...state.features, ...(data.features || {}) };
    state.profile = data.profile || state.profile;
    state.dashboardLoaded = true;
    if (state.profile?.name && state.user) {
      state.user.name = state.profile.name;
      renderUser();
    }
    if (state.profile?.pondName) $$(".pond-selector strong").forEach(element => { element.textContent = state.profile.pondName; });
    renderThresholds();
    renderAerator();
    renderAlerts();
    updateSensorDOM();
    renderIntegrationStatus();
    renderActivePage();
  }

  async function refreshDashboard(force = false) {
    if (state.polling || (!force && ($("#app-shell").classList.contains("hidden") || document.hidden))) return;
    state.polling = true;
    try {
      applyDashboard(await api.getDashboard(state.historyHours, force));
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        state.user = null;
        showAuth();
        toast("Phiên đã hết hạn", "Vui lòng đăng nhập lại bằng Firebase.", "warning");
      } else if (force || state.dashboardLoaded) {
        state.status.deviceOnline = false;
        updateSensorDOM();
        if (force) toast("Không tải được dữ liệu", error.message, "warning");
      }
    } finally { state.polling = false; }
  }

  function openAeratorModal(desired) {
    state.pendingAeratorValue = desired;
    $("#modal-message").textContent = `Gửi lệnh ${desired ? "BẬT" : "TẮT"} qua Node-RED và MQTT đến relay?`;
    $("#confirm-modal").classList.remove("hidden");
    setTimeout(() => $('[data-modal-confirm]').focus(), 20);
  }
  function closeAeratorModal() {
    $("#confirm-modal").classList.add("hidden");
    state.pendingAeratorValue = null;
    renderAerator();
  }

  function renderAerator() {
    $$(".aerator-toggle").forEach(toggle => {
      toggle.checked = Boolean(state.aerator);
      toggle.disabled = state.aeratorPending;
    });
    $$('[data-aerator-state]').forEach(element => {
      element.textContent = state.status.deviceOnline ? (state.aerator ? "Đang bật" : "Đang tắt") : "Không xác định";
    });
    $$(".aerator-card, .quick-control").forEach(element => element.classList.toggle("aerator-off", !state.aerator));
    const quickDot = $(".control-state i");
    if (quickDot) quickDot.style.background = state.aerator ? "var(--green)" : "#aab7ba";
    $$('[data-aerator-mode]').forEach(button => {
      button.classList.toggle("active", button.dataset.aeratorMode === state.mode);
      button.disabled = state.aeratorPending;
    });
    $$('[data-device-mode]').forEach(element => { element.textContent = state.mode; });
    $("#aerator-command-time").textContent = state.aeratorPending ? "Đang chờ phản hồi MQTT" : `${state.mode} · ${state.lastUpdate ? relativeTime(state.lastUpdate).toLowerCase() : "chưa có phản hồi"}`;
  }

  async function applyAeratorCommand(desired) {
    state.aeratorPending = true;
    renderAerator();
    toast("Đang gửi lệnh", `Web → Node-RED → MQTT → ESP32 → Relay (${desired ? "BẬT" : "TẮT"}).`, "info", 2200);
    try {
      const result = await api.action("relay", { command: desired ? "ON" : "OFF", mode: "MANUAL" });
      state.mode = "MANUAL";
      state.aeratorChangedAt = Date.now();
      toast("MQTT đã nhận lệnh", result.message || `Đang chờ ESP32 phản hồi trạng thái ${desired ? "BẬT" : "TẮT"}.`);
      setTimeout(() => refreshDashboard(true), 500);
    } catch (error) {
      toast("Không gửi được lệnh", error.message, "warning");
    } finally {
      state.aeratorPending = false;
      renderAerator();
    }
  }

  function initAerator() {
    $$('[data-aerator-mode]').forEach(button => button.addEventListener("click", async () => {
      const mode = button.dataset.aeratorMode;
      if (mode === state.mode || state.aeratorPending) return;
      state.aeratorPending = true;
      renderAerator();
      try {
        const result = await api.action("mode", { mode });
        state.mode = mode;
        toast("Đã đổi chế độ", result.message || `Đã gửi chế độ ${mode} đến ESP32.`);
        setTimeout(() => refreshDashboard(true), 500);
      } catch (error) { toast("Không đổi được chế độ", error.message, "warning"); }
      finally { state.aeratorPending = false; renderAerator(); }
    }));
    $$(".aerator-toggle").forEach(toggle => toggle.addEventListener("change", event => {
      const desired = event.currentTarget.checked;
      event.currentTarget.checked = state.aerator;
      if (!state.aeratorPending) openAeratorModal(desired);
    }));
    $('[data-modal-cancel]').addEventListener("click", closeAeratorModal);
    $('[data-modal-confirm]').addEventListener("click", () => {
      const desired = state.pendingAeratorValue;
      $("#confirm-modal").classList.add("hidden");
      state.pendingAeratorValue = null;
      applyAeratorCommand(desired);
    });
    $("#confirm-modal").addEventListener("click", event => {
      if (event.target === event.currentTarget) closeAeratorModal();
    });
  }

  function alertIcon(type) { return type === "danger" ? "alert" : type === "warning" ? "thermometer" : "info"; }
  function renderOverviewAlerts() {
    const container = $("#overview-alert-list");
    container.innerHTML = state.alerts.slice(0, 3).map(alert => `
      <div class="recent-alert-item ${alert.type}">
        <span>${icon(alertIcon(alert.type))}</span>
        <div><strong>${alert.title}</strong><p>${alert.message}</p></div>
        <time>${relativeTime(Number(alert.timestamp))}</time>
      </div>`).join("");
  }

  function renderAlertHistory() {
    const container = $("#alert-history-list");
    if (!state.alerts.length) {
      container.innerHTML = `<div class="empty-state"><strong>Chưa có cảnh báo</strong><p>Hệ thống sẽ ghi lại khi nhiệt độ hoặc pH vượt ngưỡng.</p></div>`;
      return;
    }
    container.innerHTML = state.alerts.map(alert => `
      <div class="alert-history-item ${alert.type}">
        <span>${icon(alertIcon(alert.type))}</span>
        <div><h4>${alert.title}</h4><p>${alert.message}</p><span class="alert-meta"><span class="telegram-delivery">${icon("send")} ${alert.delivery || (alert.telegramSent ? "Đã gửi Telegram" : "Chưa gửi Telegram")}</span><span>· ${state.status.storage === "firestore" ? "Firestore" : "Node-RED cục bộ"}</span></span></div>
        <time>${relativeTime(Number(alert.timestamp))}</time>
      </div>`).join("");
  }

  function renderNotifications() {
    const list = $("#notification-list");
    list.innerHTML = state.alerts.slice(0, 3).map(alert => `
      <div class="popover-item ${alert.unread ? "unread" : ""}">
        <span>${icon("bell")}</span><div><strong>${alert.title}</strong><p>${alert.message}</p><small>${relativeTime(Number(alert.timestamp))}</small></div>
      </div>`).join("");
    const unread = state.alerts.filter(alert => alert.unread).length;
    $("#unread-count").textContent = unread;
    $("#unread-count").classList.toggle("hidden", unread === 0);
    $("#notification-button i").classList.toggle("hidden", unread === 0);
    $("#alert-total").textContent = `${state.alerts.length} cảnh báo`;
  }

  function renderAlerts() {
    state.alerts.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    renderOverviewAlerts();
    renderAlertHistory();
    renderNotifications();
    $("#telegram-toggle").checked = state.telegram;
    $("#telegram-status-text").textContent = state.telegram ? (state.features.telegram ? "Đang bật" : "Bật · thiếu cấu hình Bot") : "Đang tắt";
  }

  function persistAlerts() {
    storage.set(STORAGE.alerts, state.alerts);
    renderAlerts();
  }

  async function simulateAlert() {
    try {
      const result = await api.action("testAlert", {});
      toast("Đã kiểm tra cảnh báo", result.message || (state.features.telegram ? "Telegram Bot API đã được gọi." : "Cảnh báo đã ghi; Telegram chưa có khóa."), "warning", 4200);
      await refreshDashboard(true);
    } catch (error) { toast("Không tạo được cảnh báo", error.message, "warning"); }
  }

  function renderThresholds() {
    const form = $("#threshold-form");
    if (!form) return;
    Object.entries(state.thresholds).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
    updateThresholdLabels();
  }

  function initAlerts() {
    $("#simulate-alert").addEventListener("click", simulateAlert);
    $("#clear-demo-alerts").addEventListener("click", () => {
      state.alerts = [];
      persistAlerts();
      toast("Đã ẩn danh sách", "Dữ liệu đã lưu trên Firestore/Node-RED không bị xóa.", "info");
    });
    $("#telegram-toggle").addEventListener("change", async event => {
      state.telegram = event.currentTarget.checked;
      renderAlerts();
      try {
        await api.action("settings", { settings: { ...state.thresholds, telegramEnabled: state.telegram, mode: state.mode } });
        toast("Đã lưu", `Cảnh báo Telegram ${state.telegram ? "được bật" : "đã tắt"}.`, "info");
      } catch (error) { toast("Không lưu được", error.message, "warning"); }
    });
    $("#threshold-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const next = {
        tempMin: Number(form.get("tempMin")),
        tempMax: Number(form.get("tempMax")),
        phMin: Number(form.get("phMin")),
        phMax: Number(form.get("phMax"))
      };
      if (!validThresholdObject(next) || next.phMin < 0 || next.phMax > 14) {
        toast("Ngưỡng chưa hợp lệ", "Giá trị tối thiểu phải nhỏ hơn tối đa và pH nằm trong miền 0–14.", "warning");
        return;
      }
      state.thresholds = next;
      storage.set(STORAGE.thresholds, next);
      renderThresholds();
      try {
        await api.action("settings", { settings: { ...next, telegramEnabled: state.telegram, mode: state.mode } });
        toast("Đã lưu ngưỡng", "Node-RED sẽ dùng cấu hình này để phát hiện bất thường và gửi Telegram.");
      } catch (error) { toast("Không lưu được ngưỡng", error.message, "warning"); }
    });
  }

  function initNotificationPopover() {
    const button = $("#notification-button");
    const popover = $("#notification-popover");
    button.addEventListener("click", event => {
      event.stopPropagation();
      const open = popover.classList.toggle("open");
      popover.setAttribute("aria-hidden", String(!open));
    });
    popover.addEventListener("click", event => event.stopPropagation());
    document.addEventListener("click", () => {
      popover.classList.remove("open");
      popover.setAttribute("aria-hidden", "true");
    });
    $("#mark-all-read").addEventListener("click", () => {
      state.alerts.forEach(alert => { alert.unread = false; });
      persistAlerts();
      toast("Đã đánh dấu đã đọc", "Các cảnh báo trên giao diện không còn ở trạng thái chưa đọc.", "info");
    });
  }

  function selectedHistory() {
    const cutoff = Date.now() - state.historyHours * HOUR;
    return state.history.filter(item => item.timestamp >= cutoff);
  }

  function historyStatus(record) {
    const t = state.thresholds;
    const tempGood = finite(record.temperature) !== null && record.temperature >= t.tempMin && record.temperature <= t.tempMax;
    const phGood = finite(record.ph) === null || (record.ph >= t.phMin && record.ph <= t.phMax);
    return tempGood && phGood ? { label: "Trong ngưỡng", className: "good" } : { label: "Ngoài ngưỡng", className: "warn" };
  }

  function renderHistoryTable() {
    const query = normalizeText(state.historySearch);
    const all = selectedHistory().slice().reverse().filter(record => {
      if (!query) return true;
      return normalizeText(formatTableDate(record.timestamp)).includes(query);
    });
    const perPage = 8;
    const pages = Math.max(1, Math.ceil(all.length / perPage));
    state.historyPage = clamp(state.historyPage, 1, pages);
    const start = (state.historyPage - 1) * perPage;
    const pageRecords = all.slice(start, start + perPage);
    $("#history-table-body").innerHTML = pageRecords.length ? pageRecords.map(record => {
      const status = historyStatus(record);
      return `<tr><td><strong>${formatTableDate(record.timestamp)}</strong></td><td>${sensorText(record.temperature, 1)} °C</td><td>${finite(record.ph) === null ? "Chưa hiệu chuẩn" : sensorText(record.ph, 2)}</td><td>${record.deviceId || "hcmus-aqua-18"} <small>· ${state.status.storage === "firestore" ? "cloud" : "local"}</small></td><td><span class="table-status ${status.className}"><i></i>${status.label}</span></td></tr>`;
    }).join("") : `<tr><td colspan="5">Không có bản ghi phù hợp.</td></tr>`;
    const shownEnd = Math.min(start + pageRecords.length, all.length);
    $("#pagination-info").textContent = all.length ? `${start + 1}–${shownEnd} trong ${all.length} bản ghi` : "0 bản ghi";
    $("#page-indicator").textContent = `${state.historyPage} / ${pages}`;
    $("#prev-page").disabled = state.historyPage <= 1;
    $("#next-page").disabled = state.historyPage >= pages;
    $("#table-record-caption").textContent = `${state.status.storage === "firestore" ? "Firebase Firestore" : "Kho cục bộ"} · khoảng ${historyPeriodLabel()}`;
  }

  function historyPeriodLabel() {
    if (state.historyHours < 24) return `${state.historyHours} giờ`;
    if (state.historyHours === 24) return "24 giờ";
    return `${state.historyHours / 24} ngày`;
  }

  function renderHistory() {
    const records = selectedHistory();
    const temperatures = records.map(item => finite(item.temperature)).filter(value => value !== null);
    const phValues = records.map(item => finite(item.ph)).filter(value => value !== null);
    const avgTemp = temperatures.reduce((sum, item) => sum + item, 0) / Math.max(1, temperatures.length);
    const avgPh = phValues.reduce((sum, item) => sum + item, 0) / Math.max(1, phValues.length);
    $("#avg-temp").textContent = temperatures.length ? `${avgTemp.toFixed(1)}°C` : "--";
    $("#avg-ph").textContent = phValues.length ? avgPh.toFixed(2) : "Chưa hiệu chuẩn";
    $("#record-count").textContent = records.length;
    $("#history-period").textContent = historyPeriodLabel();
    renderChart($("#history-chart"), records, state.historyMetric, $("#history-tooltip"));
    renderHistoryTable();
  }

  function exportCsv() {
    const records = selectedHistory();
    const lines = ["Thoi gian,Nhiet do (C),Do pH,Nguon"];
    records.forEach(record => lines.push(`"${formatTableDate(record.timestamp)}",${finite(record.temperature) === null ? "" : record.temperature.toFixed(1)},${finite(record.ph) === null ? "" : record.ph.toFixed(2)},${record.deviceId || "hcmus-aqua-18"}`));
    const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aqua-iot-data-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("Đã xuất dữ liệu", `${records.length} bản ghi đã được tạo thành tệp CSV.`);
  }

  function initHistory() {
    $$("#history-range button").forEach(button => button.addEventListener("click", event => {
      $$("#history-range button").forEach(item => item.classList.remove("active"));
      event.currentTarget.classList.add("active");
      state.historyHours = Number(event.currentTarget.dataset.hours);
      state.historyPage = 1;
      refreshDashboard(true);
    }));
    $("#history-metric").addEventListener("change", event => {
      state.historyMetric = event.currentTarget.value;
      renderHistory();
    });
    $("#history-search").addEventListener("input", event => {
      state.historySearch = event.currentTarget.value;
      state.historyPage = 1;
      renderHistoryTable();
    });
    $("#prev-page").addEventListener("click", () => { state.historyPage -= 1; renderHistoryTable(); });
    $("#next-page").addEventListener("click", () => { state.historyPage += 1; renderHistoryTable(); });
    $("#export-csv").addEventListener("click", exportCsv);
  }

  function pickChartData(records, maximum = 180) {
    if (records.length <= maximum) return records;
    const step = Math.ceil(records.length / maximum);
    const sampled = records.filter((_, index) => index % step === 0);
    const last = records[records.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled;
  }

  function scaleFor(records, key, fallbackMin, fallbackMax) {
    const values = records.map(record => Number(record[key])).filter(Number.isFinite);
    if (!values.length) return { min: fallbackMin, max: fallbackMax };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * .18, key === "ph" ? .08 : .35);
    return { min: Math.min(fallbackMin, min - padding), max: Math.max(fallbackMax, max + padding) };
  }

  function renderWithChartJs(canvas, records, metric, tooltip) {
    if (!window.Chart) return false;
    const showTemp = metric === "both" || metric === "temperature";
    const showPh = metric === "both" || metric === "ph";
    const span = records.length > 1 ? records[records.length - 1].timestamp - records[0].timestamp : 0;
    const labels = records.map(record => span > 48 * HOUR ? shortDateFormatter.format(new Date(record.timestamp)) : formatTime(record.timestamp));
    const datasets = [];
    if (showTemp) datasets.push({
      label: "Nhiệt độ (°C)",
      data: records.map(record => finite(record.temperature)),
      yAxisID: "temperature",
      borderColor: "#3e8fd3",
      backgroundColor: "rgba(62,143,211,.12)",
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: .28,
      spanGaps: true,
      fill: true
    });
    if (showPh) datasets.push({
      label: "Độ pH",
      data: records.map(record => finite(record.ph)),
      yAxisID: "ph",
      borderColor: "#12a292",
      backgroundColor: "rgba(18,162,146,.08)",
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: .28,
      spanGaps: true,
      fill: true
    });
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: true,
          callbacks: {
            title(items) {
              const record = records[items[0]?.dataIndex];
              return record ? formatTableDate(record.timestamp) : "";
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#91a2a8", maxTicksLimit: 5, maxRotation: 0 } },
        temperature: {
          display: showTemp,
          position: "left",
          suggestedMin: 24,
          suggestedMax: 30,
          grid: { color: "#edf2f2" },
          ticks: { color: "#91a2a8" }
        },
        ph: {
          display: showPh,
          position: showTemp ? "right" : "left",
          suggestedMin: 6.5,
          suggestedMax: 8,
          grid: { drawOnChartArea: !showTemp, color: "#edf2f2" },
          ticks: { color: "#91a2a8" }
        }
      }
    };
    if (tooltip) tooltip.classList.remove("visible");
    if (canvas._aquaChart) {
      canvas._aquaChart.data.labels = labels;
      canvas._aquaChart.data.datasets = datasets;
      canvas._aquaChart.options = options;
      canvas._aquaChart.update("none");
    } else {
      canvas._aquaChart = new window.Chart(canvas.getContext("2d"), { type: "line", data: { labels, datasets }, options });
    }
    return true;
  }

  function renderChart(canvas, sourceRecords, metric = "both", tooltip) {
    if (!canvas || !canvas.isConnected || canvas.clientWidth < 20 || canvas.clientHeight < 20) return;
    const records = pickChartData(sourceRecords);
    if (renderWithChartJs(canvas, records, metric, tooltip)) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const showTemp = metric === "both" || metric === "temperature";
    const showPh = metric === "both" || metric === "ph";
    const padding = { left: 43, right: metric === "both" ? 43 : 21, top: 14, bottom: 31 };
    const plotWidth = Math.max(10, width - padding.left - padding.right);
    const plotHeight = Math.max(10, height - padding.top - padding.bottom);
    const tempScale = scaleFor(records, "temperature", 24, 30);
    const phScale = scaleFor(records, "ph", 6.5, 8);
    const primaryScale = metric === "ph" ? phScale : tempScale;

    ctx.font = '8px "Segoe UI", sans-serif';
    ctx.textBaseline = "middle";
    for (let tick = 0; tick <= 4; tick += 1) {
      const y = padding.top + plotHeight * tick / 4;
      ctx.beginPath();
      ctx.strokeStyle = "#edf2f2";
      ctx.lineWidth = 1;
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotWidth, y);
      ctx.stroke();
      const fraction = 1 - tick / 4;
      ctx.fillStyle = "#91a2a8";
      ctx.textAlign = "right";
      const leftValue = primaryScale.min + (primaryScale.max - primaryScale.min) * fraction;
      ctx.fillText(metric === "ph" ? leftValue.toFixed(1) : leftValue.toFixed(1), padding.left - 7, y);
      if (metric === "both") {
        const rightValue = phScale.min + (phScale.max - phScale.min) * fraction;
        ctx.textAlign = "left";
        ctx.fillText(rightValue.toFixed(1), padding.left + plotWidth + 7, y);
      }
    }

    if (records.length) {
      const span = records[records.length - 1].timestamp - records[0].timestamp;
      const labelCount = width < 520 ? 3 : 5;
      for (let index = 0; index < labelCount; index += 1) {
        const recordIndex = Math.round((records.length - 1) * index / (labelCount - 1));
        const x = padding.left + plotWidth * recordIndex / Math.max(1, records.length - 1);
        const stamp = records[recordIndex].timestamp;
        const label = span > 48 * HOUR ? shortDateFormatter.format(new Date(stamp)) : formatTime(stamp);
        ctx.fillStyle = "#98a8ac";
        ctx.textAlign = index === 0 ? "left" : index === labelCount - 1 ? "right" : "center";
        ctx.textBaseline = "top";
        ctx.fillText(label, x, padding.top + plotHeight + 11);
      }
    }

    const drawSeries = (key, color, scale, fillColor) => {
      if (!records.length) return;
      const points = records.map((record, index) => ({ record, index })).filter(item => finite(item.record[key]) !== null).map(item => ({
        x: padding.left + plotWidth * item.index / Math.max(1, records.length - 1),
        y: padding.top + plotHeight * (1 - (item.record[key] - scale.min) / Math.max(.001, scale.max - scale.min))
      }));
      if (!points.length) return;
      const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
      gradient.addColorStop(0, fillColor);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.moveTo(points[0].x, padding.top + plotHeight);
      points.forEach(point => ctx.lineTo(point.x, point.y));
      ctx.lineTo(points[points.length - 1].x, padding.top + plotHeight);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.beginPath();
      points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();
    };
    if (showTemp) drawSeries("temperature", "#3e8fd3", tempScale, "rgba(62,143,211,.13)");
    if (showPh) drawSeries("ph", "#12a292", phScale, "rgba(18,162,146,.10)");

    canvas._chartModel = { records, metric, padding, plotWidth, plotHeight, tooltip };
    if (!canvas._chartEventsBound) {
      canvas.addEventListener("mousemove", chartMouseMove);
      canvas.addEventListener("mouseleave", () => canvas._chartModel?.tooltip?.classList.remove("visible"));
      canvas._chartEventsBound = true;
    }
  }

  function chartMouseMove(event) {
    const canvas = event.currentTarget;
    const model = canvas._chartModel;
    if (!model || !model.records.length || !model.tooltip) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const local = clamp(x - model.padding.left, 0, model.plotWidth);
    const index = Math.round(local / model.plotWidth * Math.max(1, model.records.length - 1));
    const record = model.records[index];
    const lines = [];
    if ((model.metric === "both" || model.metric === "temperature") && finite(record.temperature) !== null) lines.push(`<span>Nhiệt độ <b>${record.temperature.toFixed(1)}°C</b></span>`);
    if ((model.metric === "both" || model.metric === "ph") && finite(record.ph) !== null) lines.push(`<span>Độ pH <b>${record.ph.toFixed(2)}</b></span>`);
    model.tooltip.innerHTML = `<strong>${formatTableDate(record.timestamp)}</strong>${lines.join("")}<small>${state.status.storage === "firestore" ? "Firebase Firestore" : "Node-RED"}</small>`;
    const wrap = model.tooltip.parentElement;
    const desiredLeft = canvas.offsetLeft + model.padding.left + model.plotWidth * index / Math.max(1, model.records.length - 1) - 60;
    model.tooltip.style.left = `${clamp(desiredLeft, 5, wrap.clientWidth - 135)}px`;
    model.tooltip.style.top = "18px";
    model.tooltip.classList.add("visible");
  }

  function renderActivePage() {
    if ($("#app-shell").classList.contains("hidden")) return;
    if (state.currentPage === "overview") {
      renderChart($("#overview-chart"), state.history.slice(-24), "both", $("#overview-tooltip"));
    } else if (state.currentPage === "monitoring") {
      renderChart($("#live-chart"), state.liveBuffer, state.liveMetric, $("#live-tooltip"));
    } else if (state.currentPage === "history") {
      renderHistory();
    }
  }

  function initChartControls() {
    $$("#live-metric-control button").forEach(button => button.addEventListener("click", event => {
      $$("#live-metric-control button").forEach(item => item.classList.remove("active"));
      event.currentTarget.classList.add("active");
      state.liveMetric = event.currentTarget.dataset.metric;
      renderActivePage();
    }));
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderActivePage, 120);
    });
  }

  function addChatMessage(role, text) {
    const row = document.createElement("div");
    row.className = `message-row ${role}`;
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    if (role === "assistant") avatar.innerHTML = icon("chat");
    else avatar.textContent = initials(state.user?.name || "Demo");
    const content = document.createElement("div");
    content.className = "message-content";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = text;
    const stamp = document.createElement("span");
    stamp.className = "message-time";
    stamp.textContent = `${formatTime(Date.now())} · ${role === "assistant" ? (state.features.openai ? "OpenAI" : "trợ lý cục bộ") : "bạn"}`;
    content.append(bubble, stamp);
    if (role === "assistant") row.append(avatar, content);
    else row.append(content, avatar);
    $("#chat-messages").appendChild(row);
    $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
  }

  function resetChat() {
    $("#chat-messages").innerHTML = "";
    addChatMessage("assistant", `Xin chào ${firstName(state.user?.name)}! Tôi có thể dùng dữ liệu hiện tại, lịch sử, cảnh báo và trạng thái relay để trả lời. ${state.features.openai ? "OpenAI API đã sẵn sàng." : "Chưa có OPENAI_API_KEY nên hiện dùng câu trả lời cục bộ."}`);
  }

  function answerQuestion(question) {
    const text = normalizeText(question);
    const time = state.lastUpdate ? formatTime(state.lastUpdate) : "chưa có dữ liệu";
    if (text.includes("ph") || text.includes("do axit") || text.includes("do kiem")) {
      return finite(state.ph) === null ? "Đầu dò pH đang gửi điện áp nhưng chưa được hiệu chuẩn, nên hệ thống không suy đoán một giá trị pH giả." : `Độ pH hiện tại là ${state.ph.toFixed(2)}, cập nhật lúc ${time}. Ngưỡng đang cấu hình là ${state.thresholds.phMin}–${state.thresholds.phMax}.`;
    }
    if (text.includes("nhiet") || text.includes("°c")) {
      return finite(state.temperature) === null ? "Chưa nhận được nhiệt độ từ ESP32." : `Nhiệt độ nước hiện tại là ${state.temperature.toFixed(1)}°C, cập nhật lúc ${time}. Ngưỡng đang cấu hình là ${state.thresholds.tempMin}–${state.thresholds.tempMax}°C.`;
    }
    if (text.includes("sui") || text.includes("oxy") || text.includes("relay")) {
      return `Relay máy sủi do ESP32 phản hồi đang ở trạng thái ${state.aerator ? "BẬT" : "TẮT"}, chế độ ${state.mode}.`;
    }
    if (text.includes("canh bao") || text.includes("telegram")) {
      return `Hệ thống đang có ${state.alerts.length} cảnh báo, trong đó ${state.alerts.filter(item => item.unread).length} cảnh báo chưa đọc. Telegram ${state.telegram ? "đang bật" : "đang tắt"}${state.features.telegram ? "." : " nhưng chưa được cấu hình token/chat ID."}`;
    }
    if (text.includes("lich su") || text.includes("trung binh")) {
      const records = state.history.slice(-24);
      const temperatures = records.map(item => finite(item.temperature)).filter(item => item !== null);
      const phValues = records.map(item => finite(item.ph)).filter(item => item !== null);
      const temp = temperatures.reduce((sum, item) => sum + item, 0) / Math.max(1, temperatures.length);
      const ph = phValues.reduce((sum, item) => sum + item, 0) / Math.max(1, phValues.length);
      return `Trong ${records.length} bản ghi gần nhất, nhiệt độ trung bình ${temperatures.length ? `${temp.toFixed(1)}°C` : "chưa có"}; pH trung bình ${phValues.length ? ph.toFixed(2) : "chưa hiệu chuẩn"}. Nguồn: ${state.status.storage === "firestore" ? "Firestore" : "Node-RED cục bộ"}.`;
    }
    if (text.includes("tong") || text.includes("tinh trang") || text.includes("on dinh")) {
      return `Tóm tắt lúc ${time}: pH ${finite(state.ph) === null ? "chưa hiệu chuẩn" : state.ph.toFixed(2)}, nhiệt độ ${finite(state.temperature) === null ? "chưa có" : `${state.temperature.toFixed(1)}°C`}, relay ${state.aerator ? "đang bật" : "đang tắt"}.`;
    }
    if (text.includes("do duc") || text.includes("ts-300")) {
      return finite(state.turbidityRaw) === null ? "Chưa nhận dữ liệu TS-300B." : `TS-300B hiện có RAW ${state.turbidityRaw}${finite(state.turbidityVoltage) === null ? "" : `, điện áp module ${state.turbidityVoltage.toFixed(3)} V`}. Cảnh báo độ đục vẫn được ESP32 xử lý cục bộ bằng LED/OLED.`;
    }
    return "OpenAI chưa được cấu hình. Tôi vẫn có thể trả lời cục bộ về pH, nhiệt độ, độ đục, relay, cảnh báo và lịch sử.";
  }

  async function submitChat(question) {
    const clean = String(question || "").trim();
    if (!clean) return;
    addChatMessage("user", clean);
    $("#typing-indicator").classList.remove("hidden");
    $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
    try {
      const result = await api.action("chat", { question: clean });
      $("#typing-indicator").classList.add("hidden");
      addChatMessage("assistant", result.answer || result.message || answerQuestion(clean));
    } catch (error) {
      $("#typing-indicator").classList.add("hidden");
      addChatMessage("assistant", `${answerQuestion(clean)}\n\n(Lỗi backend: ${error.message})`);
    }
  }

  function initChat() {
    resetChat();
    $("#chat-form").addEventListener("submit", event => {
      event.preventDefault();
      const input = $("#chat-input");
      submitChat(input.value);
      input.value = "";
      input.style.height = "auto";
    });
    $("#chat-input").addEventListener("input", event => {
      event.currentTarget.style.height = "auto";
      event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 100)}px`;
    });
    $("#chat-input").addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        $("#chat-form").requestSubmit();
      }
    });
    $$("[data-question]").forEach(button => button.addEventListener("click", () => submitChat(button.dataset.question)));
    $("#clear-chat").addEventListener("click", resetChat);
  }

  function initProfile() {
    $("#profile-form").addEventListener("submit", async event => {
      event.preventDefault();
      const name = String($("#profile-name").value || "").trim();
      const pondName = String($("#pond-name").value || "").trim();
      if (name.length < 2 || pondName.length < 2) {
        toast("Thông tin chưa hợp lệ", "Tên người dùng và tên hồ cần ít nhất 2 ký tự.", "warning");
        return;
      }
      try {
        const result = await api.action("profile", { profile: { name, pondName } });
        state.user.name = result.profile?.name || name;
        state.profile = result.profile || { name, pondName };
        renderUser();
        $$(".pond-selector strong").forEach(element => { element.textContent = pondName; });
        toast("Đã lưu hồ sơ", state.status.storage === "firestore" ? "Hồ sơ đã được lưu trên Firestore." : "Hồ sơ đã được lưu trong Node-RED cục bộ.");
      } catch (error) { toast("Không lưu được hồ sơ", error.message, "warning"); }
    });
  }

  function renderIntegrationStatus() {
    const card = $(".environment-card");
    if (!card) return;
    const title = $("h3", card);
    const description = $("p", card);
    if (title) title.textContent = "Trạng thái tích hợp";
    if (description) description.textContent = "Node-RED · MQTT · dịch vụ Cloud";
    const values = $$('li b', card);
    if (values[0]) values[0].textContent = api.isFirebase ? "Đã cấu hình" : "Chế độ cục bộ";
    if (values[1]) values[1].textContent = state.status.mqttConnected ? "Đã kết nối" : "Chờ kết nối";
    if (values[2]) values[2].textContent = state.features.firestore ? "Đã kết nối" : "Lưu cục bộ";
    if (values[3]) values[3].textContent = `${state.features.openai ? "OpenAI ✓" : "OpenAI —"} / ${state.features.telegram ? "Telegram ✓" : "Telegram —"}`;
  }

  async function init() {
    initAuth();
    initNavigation();
    initAerator();
    initAlerts();
    initNotificationPopover();
    initHistory();
    initChartControls();
    initChat();
    initProfile();
    renderThresholds();
    renderAlerts();
    renderAerator();
    updateSensorDOM();
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(refreshDashboard, 3000);

    await api.ready;
    renderIntegrationStatus();
    if (api.config.offline) toast("Node-RED chưa chạy", api.config.message, "warning", 6000);
    if (!api.config.allowDemoAuth) $("#demo-login").classList.add("hidden");

    const hashPage = location.hash.replace(/^#/, "");
    if (pageTitles[hashPage]) state.currentPage = hashPage;
    const queryDemo = new URLSearchParams(location.search).get("demo") === "1";
    if (queryDemo) loginDemo();
    else if (api.currentUser) showApp(api.currentUser);
    else showAuth();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
