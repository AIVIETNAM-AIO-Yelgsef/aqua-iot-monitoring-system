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

    temperatureChart = new window.Chart(
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

function renderHistoryTable(items) {
    historyBodyElement.replaceChildren();

    for (const item of items) {
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

    loadHistoryButton.disabled = true;
    historyErrorElement.textContent = "";

    try {
        const response = await apiFetch(
            `/api/history?hours=${hours}&limit=5`
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || "Không thể đọc lịch sử"
            );
        }

        const latestFive = Array.isArray(data.history)
            ? data.history.slice(0, 5)
            : [];
        historyCountElement.textContent = latestFive.length;
        renderHistoryCharts(latestFive);
        renderHistoryTable(latestFive);
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
import { apiFetch } from "./api-client.js";
