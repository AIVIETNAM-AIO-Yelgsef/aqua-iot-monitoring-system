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

function addChatMessage(role, text) {
    const message = document.createElement("p");
    const label = document.createElement("strong");
    const content = document.createTextNode(text);

    message.className = `chat-message ${role}`;
    label.textContent =
        role === "user" ? "Bạn: " : "Trợ lý: ";

    message.append(label, content);
    chatMessagesElement.appendChild(message);
    chatMessagesElement.scrollTop =
        chatMessagesElement.scrollHeight;
}

async function sendChatQuestion(event) {
    event.preventDefault();

    const question = chatQuestionElement.value.trim();

    if (!question) {
        return;
    }

    addChatMessage("user", question);

    chatQuestionElement.value = "";
    chatErrorElement.textContent = "";
    chatSendButton.disabled = true;
    chatQuestionElement.disabled = true;

    try {
        const response = await apiFetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                question
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.message ||
                "Không thể nhận câu trả lời"
            );
        }

        addChatMessage("assistant", result.answer);
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

export function initChatbot() {
    chatForm.addEventListener("submit", sendChatQuestion);
}
import { apiFetch } from "./api-client.js";
