# Aqua IoT Web

Giao diện web thật của hệ thống giám sát nước hồ cá, được Node-RED phục vụ tại `http://localhost:1880/`.

## Các màn hình

- Tổng quan
- Giám sát trực tiếp
- Lịch sử dữ liệu và xuất CSV
- Thiết bị và điều khiển relay
- Cảnh báo và cấu hình ngưỡng
- Liên kết Telegram theo từng tài khoản bằng deep-link và nút Start
- Trợ lý AI nhiều lượt dùng dữ liệu hồ thật, có fallback cục bộ
- Cài đặt, hồ sơ và xác thực

Trang mô phỏng thiết bị, mô hình 3D, BOM và bản vẽ kỹ thuật đã được loại bỏ khỏi bản web.

## Tệp chính

```text
website/
├── index.html
├── styles.css
├── app.js
└── backend-client.js
```

Không mở trực tiếp `index.html`. Hãy chạy `nodered/BAT_DAU_WEB.cmd` để website có thể kết nối API Node-RED.

Xem hướng dẫn cài đặt Firebase, Telegram, OpenAI, MQTT và firmware tại `nodered/README.md`.
