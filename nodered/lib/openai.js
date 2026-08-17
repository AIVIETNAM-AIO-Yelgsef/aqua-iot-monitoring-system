"use strict";

const OpenAI = require("openai");

let client = null;

function getClient() {
    if (client) {
        return client;
    }

    const apiKey =
        process.env.OPENAI_API_KEY;

    const baseURL =
        String(
            process.env.OPENAI_BASE_URL || ""
        ).trim();

    if (!apiKey) {
        throw new Error(
            "Chưa cấu hình OPENAI_API_KEY"
        );
    }

    const options = {
        apiKey: apiKey, 
        defaultHeaders: {
            "User-Agent": "Mozilla/5.0"
        }
    };

    if (baseURL) {
        const parsedURL = new URL(baseURL);

        if (parsedURL.protocol !== "https:") {
            throw new Error(
                "OPENAI_BASE_URL phải sử dụng HTTPS"
            );
        }

        options.baseURL =
            baseURL.replace(/\/+$/, "");
    }

    client = new OpenAI(options);

    return client;
}

async function askAquaAssistant(
    question,
    aquaContext
) {
    const cleanQuestion =
        String(question || "").trim();

    if (!cleanQuestion) {
        throw new Error(
            "Câu hỏi không được để trống"
        );
    }

    if (cleanQuestion.length > 500) {
        throw new Error(
            "Câu hỏi không được dài quá 500 ký tự"
        );
    }

    const model =
        process.env.OPENAI_MODEL ||
        "gpt-5.4-mini";

    const response =
        await getClient().responses.create({
            model: model,

            instructions:
                "Bạn là trợ lý cho hệ thống giám sát nước hồ cá Aqua IoT. " +
                "Chỉ trả lời dựa trên dữ liệu hệ thống được cung cấp. Nếu không có đủ dữ liệu, hãy nói rõ rằng chưa đủ dữ liệu. " +
                "Không tự tạo giá trị cảm biến.",

            input:
                "Dữ liệu hệ thống:\n" +
                JSON.stringify(aquaContext) +
                "\n\nCâu hỏi người dùng:\n" +
                cleanQuestion
        });

    const answer =
        String(response.output_text || "").trim();

    if (!answer) {
        throw new Error(
            "OpenAI không trả về nội dung"
        );
    }

    return {
        answer: answer,
        responseId: response.id,
        model: response.model
    };
}

module.exports = {
    askAquaAssistant
};