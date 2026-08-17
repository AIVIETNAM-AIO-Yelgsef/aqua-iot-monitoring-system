"use strict";

function createChatbot({ baseUrl, limit, windowMs }) {
  let client = null;
  let lastError = null;
  let lastSuccessAt = null;
  const requests = new Map();

  function status() {
    const providerUrl = baseUrl || "https://api.openai.com/v1";
    let hostname = "api.openai.com";
    try { hostname = new URL(providerUrl).hostname; } catch (_) { lastError = "OPENAI_BASE_URL_INVALID"; }
    const official = hostname === "api.openai.com";
    return {
      configured: Boolean(process.env.OPENAI_API_KEY), available: Boolean(process.env.OPENAI_API_KEY && !lastError),
      degraded: Boolean(process.env.OPENAI_API_KEY && lastError), model: process.env.OPENAI_API_KEY ? (process.env.OPENAI_MODEL || "gpt-5.4-nano") : null,
      reason: lastError, provider: { id: official ? "openai" : "openai-compatible", label: official ? "OpenAI" : "Dịch vụ AI tương thích OpenAI", hostname, official }, lastSuccessAt
    };
  }

  function allow(user) {
    const now = Date.now();
    const recent = (requests.get(user.uid) || []).filter(item => item > now - windowMs);
    if (recent.length >= limit) {
      const error = new Error("Bạn gửi câu hỏi quá nhanh. Hãy thử lại sau ít phút.");
      error.statusCode = 429;
      throw error;
    }
    recent.push(now);
    requests.set(user.uid, recent);
  }

  async function answer(question, user, context, history = []) {
    allow(user);
    if (!process.env.OPENAI_API_KEY) return null;
    if (!client) {
      const sdk = require("openai");
      const OpenAI = sdk.OpenAI || sdk.default || sdk;
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, ...(baseUrl ? { baseURL: baseUrl } : {}) });
    }
    const messages = Array.isArray(history) ? history.slice(-10)
      .filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
      .map(item => ({ role: item.role, content: item.content.slice(0, 500) })) : [];
    try {
      const response = await client.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-5.4-nano",
        input: [{ role: "system", content: `Ban la tro ly du lieu ho ca. Tra loi ngan gon bang tieng Viet. Du lieu tin cay: ${JSON.stringify(context)}` }, ...messages, { role: "user", content: question }],
        max_output_tokens: Math.min(2000, Math.max(100, Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 500))
      });
      lastError = null;
      lastSuccessAt = new Date().toISOString();
      return response.output_text || "Khong nhan duoc cau tra loi.";
    } catch (error) {
      lastError = error?.name === "AbortError" ? "OPENAI_TIMEOUT" : "OPENAI_REQUEST_FAILED";
      throw error;
    }
  }

  return { answer, status };
}

module.exports = { createChatbot };
