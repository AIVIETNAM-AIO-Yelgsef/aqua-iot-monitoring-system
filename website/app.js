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
    event.preventDefault(); // Bình thường sẽ reload hoặc chuyển trang nên ngăn chặn việc đó để js xử lý
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
    logoutButton.disabled = true; // Disable để user không click nhiều lần 
    try {
        await logout();
    } finally { // Dù logout có lỗi hay không thì vẫn chạy 
        logoutButton.disabled = false; // logout xong enable lại 
    }
});

// Theo dõi trạng thái đăng nhập, mỗi khi thay đổi thì kiểm tra trạng thái User
watchAuth((user) => {
    const loggedIn = Boolean(user);
    loginScreen.hidden = loggedIn;
    appShell.hidden = !loggedIn;

    if (!loggedIn || initialized) return; // User chưa login hay dashboard chưa khởi tạo

    const monitoring = initMonitoring();

    // Sau khi Relay xử lý xong thì refresh
    initRelayControl({ refreshDashboard: monitoring.loadDashboard });
    initCloudHistory();
    initChatbot();
    initialized = true;
});
