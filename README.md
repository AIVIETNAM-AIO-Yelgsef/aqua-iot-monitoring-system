# Aqua IoT Monitoring System

Hệ thống IoT giám sát chất lượng nước hồ cá bằng ESP32, Node-RED, MQTT và giao diện web responsive.

## Chức năng chính

- Đo nhiệt độ nước bằng DS18B20.
- Đọc tín hiệu cảm biến độ đục và module pH qua ADC có cầu chia áp.
- Hiển thị dữ liệu và cảnh báo trên OLED.
- Điều khiển relay máy sủi ở chế độ thủ công hoặc nhận chế độ từ MQTT.
- Gửi dữ liệu ESP32 tới Node-RED qua Mosquitto MQTT.
- Theo dõi trực tiếp, lịch sử, cảnh báo và trạng thái thiết bị trên website.
- Hỗ trợ tùy chọn Firebase Authentication/Firestore, Telegram và OpenAI hoặc endpoint tương thích; hệ thống vẫn chạy cục bộ khi chưa cấu hình các dịch vụ này.

## Cấu trúc repository

```text
firmware/   Mã Arduino cho ESP32
nodered/    Node-RED, MQTT broker, API backend và script khởi động
website/    Giao diện quản lý responsive
*.pdf       Báo cáo và tài liệu yêu cầu dự án
```

## Chạy hệ thống trên Windows

1. Cài Node.js và Mosquitto.
2. Mở `nodered/TAO_CAU_HINH.cmd` nếu cần cấu hình Firebase, Telegram hoặc OpenAI.
3. Chạy `nodered/BAT_DAU_WEB.cmd`.
4. Mở `http://localhost:1880/`.
5. Chỉnh Wi-Fi và địa chỉ MQTT trong firmware trước khi nạp cho ESP32.

Hướng dẫn chi tiết nằm tại [`nodered/README.md`](nodered/README.md), [`website/README.md`](website/README.md) và [`firmware/README.md`](firmware/README.md).

## An toàn cấu hình

Khóa dịch vụ, service account, cấu hình cục bộ, dữ liệu đo, log và thư mục phụ thuộc không được đưa lên Git. Chỉ sử dụng `nodered/config.example.ps1` làm mẫu cấu hình.
