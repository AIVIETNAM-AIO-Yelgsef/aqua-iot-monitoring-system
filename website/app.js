// Dữ liệu bình thường 
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

// Xử lý relay
const relayOnButton =
    document.getElementById("relay-on-button");

const relayOffButton =
    document.getElementById("relay-off-button");

const relayMessageElement =
    document.getElementById("relay-message");

// Đọc lịch sử
const historyHoursElement =
    document.getElementById("history-hours");

const loadHistoryButton =
    document.getElementById("load-history-button");

const historyCountElement =
    document.getElementById("history-count");

const historyErrorElement =
    document.getElementById("history-error");

const historyBodyElement =
    document.getElementById("history-body");

// Biểu đồ 
const temperatureChartCanvas =
    document.getElementById("temperature-chart");

const phChartCanvas =
    document.getElementById("ph-chart");

let temperatureChart = null;
let phChart = null;

// ChatGPT
const chatForm =
    document.getElementById("chat-form");

const chatQuestionElement =
    document.getElementById("chat-question");

const chatSendButton =
    document.getElementById("chat-send-button");

const chatMessagesElement =
    document.getElementById("chat-messages");

const chatErrorElement =
    document.getElementById("chat-error");
async function setRelay(relayOn) {
    relayOnButton.disabled = true;
    relayOffButton.disabled = true;

    relayMessageElement.textContent =
        "Đang gửi lệnh...";

    try {
        const response = await fetch("/api/relay", {
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

        relayMessageElement.textContent =
            relayOn
                ? "Đã gửi lệnh bật relay"
                : "Đã gửi lệnh tắt relay";

        // Đọc lại trạng thái ESP32 gửi về qua telemetry.
        setTimeout(loadDashboard, 1000);
    } catch (error) {
        relayMessageElement.textContent =
            `Lỗi: ${error.message}`;
    } finally {
        relayOnButton.disabled = false;
        relayOffButton.disabled = false;
    }
}


async function loadDashboard() {
    try {
        const response = await fetch("/api/dashboard");

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

function renderHistoryCharts(items) {
    const labels = items.map((item) => {
        return new Date(
            item.receivedAt
        ).toLocaleString("vi-VN");
    });

    if (temperatureChart) {
        temperatureChart.destroy();
    }

    if (phChart) {
        phChart.destroy();
    }

    temperatureChart = new Chart(
        temperatureChartCanvas,
        {
            type: "line",
            data: {
                labels,
                datasets: [
                    {
                        label: "Nhiệt độ (°C)",
                        data: items.map((item) => {
                            return item.temperature;
                        }),
                        borderColor: "#e76f51",
                        backgroundColor: "rgba(231, 111, 81, 0.15)",
                        tension: 0.3,
                        spanGaps: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: "index",
                    intersect: false
                }
            }
        }
    );

    phChart = new Chart(
        phChartCanvas,
        {
            type: "line",
            data: {
                labels,
                datasets: [
                    {
                        label: "pH",
                        data: items.map((item) => {
                            return item.ph;
                        }),
                        borderColor: "#2a9d8f",
                        backgroundColor: "rgba(42, 157, 143, 0.15)",
                        tension: 0.3,
                        spanGaps: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: "index",
                    intersect: false
                },
                scales: {
                    y: {
                        min: 0,
                        max: 14
                    }
                }
            }
        }
    );
}

async function loadHistory() {
    const hours = historyHoursElement.value;

    loadHistoryButton.disabled = true;
    historyErrorElement.textContent = "";

    try {
        const response = await fetch(
            `/api/history?hours=${hours}&limit=100`
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || "Không thể đọc lịch sử"
            );
        }

        historyCountElement.textContent = data.count;
        renderHistoryCharts(data.history);
        historyBodyElement.replaceChildren();

        for (const item of data.history) {
            const row = document.createElement("tr");

            const timeCell = document.createElement("td");
            timeCell.textContent = new Date(
                item.receivedAt
            ).toLocaleString("vi-VN");

            const temperatureCell =
                document.createElement("td");

            temperatureCell.textContent =
                item.temperature === null
                    ? "--"
                    : `${item.temperature.toFixed(1)} °C`;

            const phCell = document.createElement("td");
            phCell.textContent =
                item.ph === null
                    ? "Chưa hiệu chuẩn"
                    : item.ph.toFixed(2);

            const relayCell =
                document.createElement("td");

            relayCell.textContent =
                item.relayOn ? "Bật" : "Tắt";

            row.append(
                timeCell,
                temperatureCell,
                phCell,
                relayCell
            );

            historyBodyElement.appendChild(row);
        }
    } catch (error) {
        historyCountElement.textContent = "0";
        historyBodyElement.replaceChildren();
        renderHistoryCharts([]);
        
        historyErrorElement.textContent =
            `Lỗi: ${error.message}`;
    } finally {
        loadHistoryButton.disabled = false;
    }
}

function addChatMessage(role, text) {
    const message = document.createElement("p");

    message.className =
        `chat-message ${role}`;

    const label = document.createElement("strong");

    label.textContent =
        role === "user" ? "Bạn: " : "Trợ lý: ";

    const content = document.createTextNode(text);

    message.append(label, content);
    chatMessagesElement.appendChild(message);

    chatMessagesElement.scrollTop =
        chatMessagesElement.scrollHeight;
}

async function sendChatQuestion(event) {
    event.preventDefault();

    const question =
        chatQuestionElement.value.trim();

    if (!question) {
        return;
    }

    addChatMessage("user", question);

    chatQuestionElement.value = "";
    chatErrorElement.textContent = "";
    chatSendButton.disabled = true;
    chatQuestionElement.disabled = true;

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                question: question
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.message ||
                "Không thể nhận câu trả lời"
            );
        }

        addChatMessage(
            "assistant",
            result.answer
        );
    } catch (error) {
        chatErrorElement.textContent =
            `Lỗi: ${error.message}`;

        chatQuestionElement.value = question;
    } finally {
        chatSendButton.disabled = false;
        chatQuestionElement.disabled = false;
        chatQuestionElement.focus();
    }
}

chatForm.addEventListener(
    "submit",
    sendChatQuestion
);

relayOnButton.addEventListener("click", () => {
    setRelay(true);
});

relayOffButton.addEventListener("click", () => {
    setRelay(false);
});

loadHistoryButton.addEventListener("click", () => {
    loadHistory();
});

loadDashboard();
loadHistory();

setInterval(loadDashboard, 3000);
