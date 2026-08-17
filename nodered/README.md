# Aqua IoT — web quản lý theo proposal nhóm 18

Hệ thống gồm web responsive, Node-RED backend, HiveMQ Public và firmware ESP32. Khi chưa nhập khóa Cloud, luồng ESP32 → MQTT → web → relay vẫn hoạt động bằng kho JSON cục bộ. Firebase, Telegram và OpenAI tự bật khi có cấu hình hợp lệ.

## Chức năng đã triển khai

| ID báo cáo | Chức năng |
|---|---|
| CB1 | Hiển thị nhiệt độ và pH thật; pH hiện “chưa hiệu chuẩn” thay vì tạo số giả |
| CB2 | Bật/tắt relay từ web qua MQTT, có phản hồi ESP32 và chế độ MANUAL/AUTO |
| YC1 | ESP32 tự cảnh báo độ đục bằng LED xanh/đỏ và OLED, không phụ thuộc Internet |
| YC4 | Firestore lưu telemetry, cảnh báo, hồ sơ và lịch sử lệnh; có kho JSON dự phòng |
| YC5 | Biểu đồ/bảng lịch sử 6 giờ–30 ngày và xuất CSV |
| YC6 | Kiểm tra ngưỡng pH/nhiệt độ, cooldown và gửi Telegram Bot API |
| YC8 | Chatbot OpenAI dùng dữ liệu hiện tại, lịch sử, cảnh báo và relay làm ngữ cảnh |
| YC9 | Firebase email/password, backend xác minh ID token, hồ sơ/quyền trong Firestore |

## Chạy nhanh

Từ root repository:

```bash
cp .env.example .env
cd nodered
npm install
npm start
```

Mở <http://localhost:1880/>. Nếu chưa cấu hình Firebase, chọn **Vào chế độ cục bộ**. Nhấn `Ctrl+C` tại terminal để dừng Node-RED.

Các địa chỉ:

- Web quản lý: <http://localhost:1880/>
- Node-RED Editor: <http://localhost:1880/red>
- Dashboard kỹ thuật: <http://localhost:1880/dashboard/aquarium>
- MQTT Broker: `broker.hivemq.com:1883`

Điện thoại cùng Wi-Fi mở `http://IP_MAY_TIN:1880/`. Xem IPv4 bằng `ipconfig`; chỉ cần cho phép Node.js qua Windows Firewall ở mạng **Private** nếu cần.

## Cấu hình Firebase, Telegram và OpenAI

1. Sao chép `.env.example` ở root repository thành `.env` nếu chưa có và đổi `NODE_RED_CREDENTIAL_SECRET`.
2. Điền các biến cần dùng rồi lưu.
3. Khởi động lại `npm start`.

`.env`, service-account JSON và dữ liệu runtime đã được `.gitignore`; không gửi chúng lên GitHub.

### Firebase Authentication + Firestore

Trong Firebase Console:

1. Tạo project và Web App, chép cấu hình Web vào sáu biến `FIREBASE_*`.
2. Authentication → Sign-in method → bật **Email/Password**.
3. Firestore Database → tạo database.
4. Project settings → Service accounts → **Generate new private key**.
5. Lưu JSON ngoài thư mục public, đặt đường dẫn tuyệt đối vào `FIREBASE_SERVICE_ACCOUNT_PATH`.
6. Khi thử xong, đặt `AQUA_ALLOW_DEMO_AUTH=false` để buộc đăng nhập Firebase.

Frontend chỉ nhận cấu hình Firebase Web công khai. Private key Admin, Telegram token và OpenAI key chỉ được đọc ở backend. ID token gửi bằng header `Authorization: Bearer ...` và được Firebase Admin xác minh trước khi trả dashboard.

### Telegram

1. Nhắn `@BotFather`, tạo bot và lấy token.
2. Gửi một tin nhắn cho bot.
3. Lấy `chat_id`, điền `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID`.
4. Trên web, bật Telegram và dùng **Gửi cảnh báo thử**.

### OpenAI

Điền `OPENAI_API_KEY`; có thể đổi `OPENAI_MODEL`. Backend dùng Responses API và chỉ gửi câu hỏi cùng phần dữ liệu hệ thống cần thiết. Nếu thiếu key, trang chat vẫn trả lời cục bộ và ghi rõ chế độ fallback.

## MQTT

| Topic | Chiều | Nội dung |
|---|---|---|
| `aquaiot/hcmus-aqua-18/telemetry` | ESP32 → Node-RED | dữ liệu cảm biến và trạng thái relay |
| `aquaiot/hcmus-aqua-18/status` | ESP32 → Node-RED | `online`/`offline`, retained/LWT |
| `aquaiot/hcmus-aqua-18/command` | Node-RED → ESP32 | `ON`, `OFF`, `MODE`; `MANUAL`/`AUTO` |

HiveMQ Public không cần tài khoản và chỉ phù hợp cho demo/học tập. Không gửi secret hoặc dữ liệu nhạy cảm qua topic public.

## Nạp firmware ESP32

1. Cài `PubSubClient`, `OneWire`, `DallasTemperature`, `Adafruit GFX`, `Adafruit SSD1306`.
2. Mở `firmware/aqua_iot_nodered/aqua_iot_nodered.ino`.
3. Điền `WIFI_SSID` và `WIFI_PASSWORD`. Giữ broker mặc định nếu dùng bản demo public.
4. Chọn **ESP32 Dev Module**, đúng COM, rồi Upload.
5. Serial Monitor 115200 baud để xem kết nối và telemetry.

Sơ đồ chân: DS18B20 GPIO13; pH GPIO34; độ đục GPIO35; LED xanh/đỏ GPIO18/19 qua 330Ω; relay GPIO26; OLED SDA22/SCL23 địa chỉ 0x3C. Hai analog dùng cầu chia module → 20kΩ → ADC → 4,7kΩ → GND.

Ngưỡng độ đục mặc định trong firmware là điện áp module `< 2,50 V`; đây chỉ là điểm bắt đầu, cần hiệu chuẩn bằng mẫu nước thật. Chế độ AUTO hiện được truyền và hiển thị nhưng không tự bật relay vì proposal chưa xác định quy tắc an toàn. pH cũng phải hiệu chuẩn trước khi web hiển thị/Telegram cảnh báo pH.

## API backend

- `GET /api/config` — cấu hình công khai và trạng thái tính năng.
- `GET /api/dashboard?hours=24` — telemetry, lịch sử, cảnh báo, cấu hình, hồ sơ.
- `POST /api/action` — `relay`, `mode`, `settings`, `profile`, `chat`, `testAlert`.
- `GET /api/health` — trạng thái backend/persistence.

## Lệnh npm

- `npm start`: chạy Node-RED với `nodered/` làm user directory.
- `npm run check`: kiểm tra JavaScript backend và cú pháp `flows.json`.
