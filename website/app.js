import { watchAuth, login, logout } from "./features/auth.js";
import { initMonitoring } from "./features/monitoring.js";
import { initRelayControl } from "./features/relay-control.js";
import { initCloudHistory } from "./features/cloud-history.js";
import { initChatbot } from "./features/chatbot.js";

const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app-shell");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
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
