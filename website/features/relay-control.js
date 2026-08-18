import { apiFetch } from "./api-client.js";

const relayOnButton =
    document.getElementById("relay-on-button");

const relayOffButton =
    document.getElementById("relay-off-button");

const relayMessageElement =
    document.getElementById("relay-message");

async function setRelay(relayOn, refreshDashboard) {
    relayOnButton.disabled = true;
    relayOffButton.disabled = true;
    relayMessageElement.textContent = "Đang gửi lệnh...";

    try {
        const response = await apiFetch("/api/relay", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                relayOn
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.message || "Không thể gửi lệnh"
            );
        }

        relayMessageElement.textContent = relayOn
            ? "Đã gửi lệnh bật relay"
            : "Đã gửi lệnh tắt relay";

        // Telemetry từ ESP32 mới là trạng thái relay thực tế.
        setTimeout(refreshDashboard, 1000);
    } catch (error) {
        relayMessageElement.textContent =
            `Lỗi: ${error.message}`;
    } finally {
        relayOnButton.disabled = false;
        relayOffButton.disabled = false;
    }
}

export function initRelayControl({ refreshDashboard }) {
    relayOnButton.addEventListener("click", () => {
        setRelay(true, refreshDashboard);
    });

    relayOffButton.addEventListener("click", () => {
        setRelay(false, refreshDashboard);
    });
}
