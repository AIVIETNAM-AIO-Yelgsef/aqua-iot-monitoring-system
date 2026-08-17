# Aqua IoT Monitoring System

Hệ thống IoT giám sát chất lượng nước hồ cá bằng ESP32, Node-RED, MQTT public và giao diện web responsive.

## Chức năng chính

- Đo nhiệt độ nước bằng DS18B20.
- Đọc tín hiệu cảm biến độ đục và module pH qua ADC có cầu chia áp.
- Hiển thị dữ liệu và cảnh báo trên OLED.
- Điều khiển relay máy sủi ở chế độ thủ công hoặc nhận chế độ từ MQTT.
- Gửi dữ liệu ESP32 tới Node-RED qua broker MQTT public.
- Theo dõi trực tiếp, lịch sử, cảnh báo và trạng thái thiết bị trên website.
- Hỗ trợ tùy chọn Firebase Authentication/Firestore, Telegram và OpenAI; hệ thống vẫn chạy cục bộ khi chưa cấu hình các dịch vụ này.

## Cấu trúc repository

```text
firmware/   Mã Arduino cho ESP32
nodered/    Node-RED, API backend và script khởi động
website/    Giao diện quản lý responsive
docs/       Kiến trúc và contract MQTT tối giản
```

Luồng chính chỉ gồm: `ESP32 -> HiveMQ Public -> Node-RED -> website`. Xem [`docs/architecture.md`](docs/architecture.md).

## Chạy hệ thống

1. Cài Node.js 20 trở lên. Không cần cài Node-RED global hoặc Mosquitto.
2. Sao chép `.env.example` thành `.env`, đổi `NODE_RED_CREDENTIAL_SECRET` và điền các dịch vụ cần dùng.
3. Chạy `cd nodered`, `npm install`, rồi `npm start`.
4. Mở `http://localhost:1880/`; nhấn `Ctrl+C` để dừng.
5. Điền Wi-Fi trong firmware rồi nạp cho ESP32. Broker public đã được cấu hình sẵn.

Hướng dẫn chi tiết nằm tại [`nodered/README.md`](nodered/README.md) và [`website/README.md`](website/README.md).

## An toàn cấu hình

Khóa dịch vụ, service account, `.env`, dữ liệu đo, log và thư mục phụ thuộc không được đưa lên Git. Danh sách biến cấu hình nằm trong `.env.example`.
