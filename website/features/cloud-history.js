import { apiFetch } from "./api-client.js";

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

const temperatureChartCanvas =
    document.getElementById("temperature-chart");

const phChartCanvas =
    document.getElementById("ph-chart");

let temperatureChart = null;
let phChart = null;
 
const TABLE_HISTORY_LIMIT = 5;

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
    // Tạo biểu đồ mới
    temperatureChart = new window.Chart( // Chart.js 
        temperatureChartCanvas,
        {
            type: "line", // Biểu đồ đường
            data: {
                labels, // Time trên trục X
                datasets: [
                    {
                        label: "Nhiệt độ (°C)",
                        data: items.map((item) => {
                            return item.temperature;
                        }),
                        borderColor: "#e76f51",
                        backgroundColor: "rgba(231, 111, 81, 0.15)",
                        tension: 0.3, // Uốn mượt đường nối
                        spanGaps: true
                    }
                ]
            },
            options: {
                responsive: true, // Dynamic kích thước
                maintainAspectRatio: false,
                interaction: {
                    mode: "index", // Hover theo index X
                    intersect: false // Không cần chính xác điểm
                }
            }
        }
    );

    phChart = new window.Chart(
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
                }
            }
        }
    );
}

function renderHistoryTable(items) {
    historyBodyElement.replaceChildren(); // Xóa hàng cũ trong <tbody>

    for (const item of items) { // 1 hàng 4 cột (1 table row 4 table data)
        const row = document.createElement("tr");
        const timeCell = document.createElement("td");
        const temperatureCell = document.createElement("td");
        const phCell = document.createElement("td");
        const relayCell = document.createElement("td");

        timeCell.textContent = new Date(
            item.receivedAt
        ).toLocaleString("vi-VN");

        temperatureCell.textContent =
            item.temperature === null
                ? "--"
                : `${item.temperature.toFixed(1)} °C`;

        phCell.textContent =
            item.ph === null
                ? "Chưa hiệu chuẩn"
                : item.ph.toFixed(2);

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
}

async function loadHistory() {
    const hours = historyHoursElement.value;
    const limit = hours * 60;

    loadHistoryButton.disabled = true;
    historyErrorElement.textContent = "";

    try {
        const response = await apiFetch(
            `/api/history?hours=${hours}&limit=${limit}`
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || "Không thể đọc lịch sử"
            );
        }

        const chartItems = Array.isArray(data.history)
            ? data.history
            : [];
        const tableItems = chartItems.slice(-TABLE_HISTORY_LIMIT);

        historyCountElement.textContent = tableItems.length;
        renderHistoryCharts(chartItems);
        renderHistoryTable(tableItems);
    } catch (error) {
        historyCountElement.textContent = "0";
        renderHistoryCharts([]);
        renderHistoryTable([]);

        historyErrorElement.textContent =
            `Lỗi: ${error.message}`;
    } finally {
        loadHistoryButton.disabled = false;
    }
}

export function initCloudHistory() {
    loadHistoryButton.addEventListener("click", loadHistory);
    loadHistory();
}
