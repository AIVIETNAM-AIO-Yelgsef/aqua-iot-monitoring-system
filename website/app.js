import { initMonitoring } from "./features/monitoring.js";
import { initRelayControl } from "./features/relay-control.js";
import { initCloudHistory } from "./features/cloud-history.js";
import { initChatbot } from "./features/chatbot.js";

const monitoring = initMonitoring();

initRelayControl({
    refreshDashboard: monitoring.loadDashboard
});

initCloudHistory();
initChatbot();
