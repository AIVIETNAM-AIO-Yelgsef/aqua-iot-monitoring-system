const temperatureElement =
    document.getElementById("temperature");

const phElement =
    document.getElementById("ph");

const relayStatusElement =
    document.getElementById("relay-status");

const deviceStatusElement =
    document.getElementById("device-status");

const updatedAtElement =
    document.getElementById("updated-at");

const apiErrorElement =
    document.getElementById("api-error");

async function loadDashboard() {
    try {
        const response = await apiFetch("/api/dashboard");

        if (!response.ok) {
            throw new Error(
                `API trả về mã ${response.status}`
            );
        }

        const data = await response.json();
        const latest = data.latest;
        const status = data.status;

        if (!latest) {
            temperatureElement.textContent = "--";
            phElement.textContent = "--";
            relayStatusElement.textContent = "--";
            updatedAtElement.textContent = "--";
        } else {
            temperatureElement.textContent =
                latest.temperature === null
                    ? "--"
                    : `${latest.temperature.toFixed(1)} °C`;

            phElement.textContent =
                latest.ph === null
                    ? "Chưa hiệu chuẩn"
                    : latest.ph.toFixed(2);

            relayStatusElement.textContent =
                latest.relayOn ? "Đang bật" : "Đang tắt";

            updatedAtElement.textContent =
                new Date(
                    latest.receivedAt
                ).toLocaleString("vi-VN");
        }

        deviceStatusElement.textContent =
            status && status.online
                ? "Trực tuyến"
                : "Ngoại tuyến";

        apiErrorElement.textContent = "";
    } catch (error) {
        apiErrorElement.textContent =
            `Không thể đọc dữ liệu: ${error.message}`;
    }
}

export function initMonitoring() {
    loadDashboard();
    setInterval(loadDashboard, 3000);

    return {
        loadDashboard
    };
}
import { apiFetch } from "./api-client.js";
