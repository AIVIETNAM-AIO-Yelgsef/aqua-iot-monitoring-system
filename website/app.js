import { watchAuth, login, register, logout } from "./features/auth.js";
import { initMonitoring } from "./features/monitoring.js";
import { initRelayControl } from "./features/relay-control.js";
import { initCloudHistory } from "./features/cloud-history.js";
import { initChatbot } from "./features/chatbot.js";

const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app-shell");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const registerForm = document.getElementById("register-form");
const registerError = document.getElementById("register-error");
const logoutButton = document.getElementById("logout-button");
let initialized = false;

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    try {
        await login(
            document.getElementById("login-email").value,
            document.getElementById("login-password").value
        );
    } catch (error) {
        loginError.textContent = error.message;
    }
});

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    registerError.textContent = "";
    const password = document.getElementById("register-password").value;
    const confirmation = document.getElementById("register-password-confirm").value;
    if (password !== confirmation) {
        registerError.textContent = "Mật khẩu nhập lại không khớp.";
        return;
    }
    try {
        await register(
            document.getElementById("register-email").value,
            password,
            document.getElementById("register-name").value
        );
    } catch (error) {
        registerError.textContent = error.message;
    }
});

logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    try {
        await logout();
    } finally {
        logoutButton.disabled = false;
    }
});

watchAuth((user) => {
    const loggedIn = Boolean(user);
    loginScreen.hidden = loggedIn;
    appShell.hidden = !loggedIn;

    if (!loggedIn || initialized) return;

    const monitoring = initMonitoring();

    initRelayControl({ refreshDashboard: monitoring.loadDashboard });
    initCloudHistory();
    initChatbot();
    initialized = true;
});
