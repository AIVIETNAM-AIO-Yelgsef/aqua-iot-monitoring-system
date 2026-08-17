# Aqua IoT Monitoring System

Hệ thống IoT giám sát chất lượng nước hồ cá bằng ESP32, Node-RED, MQTT và giao diện web responsive.

## Chức năng chính

- Đo nhiệt độ nước bằng DS18B20.
- Đọc tín hiệu cảm biến độ đục và module pH qua ADC có cầu chia áp.
- Hiển thị dữ liệu và cảnh báo trên OLED.
- Điều khiển relay máy sủi ở chế độ thủ công hoặc nhận chế độ từ MQTT.
- Gửi dữ liệu ESP32 tới Node-RED qua broker công cộng HiveMQ.
- Theo dõi trực tiếp, lịch sử, cảnh báo và trạng thái thiết bị trên website.
- Hỗ trợ tùy chọn Firebase Authentication/Firestore, Telegram và OpenAI hoặc endpoint tương thích; hệ thống vẫn chạy cục bộ khi chưa cấu hình các dịch vụ này.
- Cô lập hồ sơ, cấu hình, lịch sử và cảnh báo theo UID; chỉ tài khoản đã liên kết Device ID mới xem và điều khiển ESP32 tương ứng.

## Cấu trúc repository

```text
firmware/      Mã Arduino cho ESP32 và hướng dẫn provisioning
nodered/       Node-RED, API backend, test và kho dữ liệu cục bộ
website/       Giao diện quản lý responsive
docs/          Kiến trúc và contract hệ thống
requirements/  Báo cáo và tài liệu yêu cầu dự án
```

## Chạy hệ thống

1. Cài Node.js 20 trở lên và sao chép `.env.example` thành `.env`.
2. Đổi `NODE_RED_CREDENTIAL_SECRET`; điền Firebase, Telegram hoặc AI nếu sử dụng.
3. Chạy `cd nodered`, `npm install`, rồi `npm start`.
4. Mở `http://localhost:1880/`; nhấn `Ctrl+C` để dừng.
5. Nạp firmware, quét [`firmware/AquaIoT-Setup-QR.png`](firmware/AquaIoT-Setup-QR.png), chọn Wi-Fi 2.4 GHz và nhập mật khẩu trên trang cài đặt của ESP32.

Hướng dẫn chi tiết nằm tại [`nodered/README.md`](nodered/README.md), [`website/README.md`](website/README.md) và [`firmware/README.md`](firmware/README.md).

## An toàn cấu hình

Khóa dịch vụ, service account, `.env`, dữ liệu đo, log và thư mục phụ thuộc không được đưa lên Git. Danh sách biến cấu hình nằm trong `.env.example`.
