# Aqua IoT — web quản lý theo proposal nhóm 18

Hệ thống gồm web responsive, Node-RED backend, HiveMQ Public MQTT và firmware ESP32. Máy tính không còn chạy broker; ESP32 và Node-RED cùng kết nối Internet tới HiveMQ. Firebase, Telegram và nhà cung cấp AI tự bật khi có cấu hình hợp lệ.

## Chức năng đã triển khai

| ID báo cáo | Chức năng |
|---|---|
| CB1 | Hiển thị nhiệt độ và pH thật; pH hiện “chưa hiệu chuẩn” thay vì tạo số giả |
| CB2 | Bật/tắt relay từ web qua MQTT, có phản hồi ESP32 và chế độ MANUAL/AUTO |
| YC1 | ESP32 tự cảnh báo độ đục bằng LED xanh/đỏ và OLED, không phụ thuộc Internet |
| YC4 | Firestore lưu telemetry, cảnh báo, hồ sơ và lịch sử lệnh; có kho JSON dự phòng |
| YC5 | Biểu đồ/bảng lịch sử 6 giờ–30 ngày và xuất CSV |
| YC6 | Kiểm tra ngưỡng pH/nhiệt độ, cooldown và gửi Telegram Bot API |
| YC8 | Chatbot Responses API dùng dữ liệu hiện tại, lịch sử, cảnh báo và relay làm ngữ cảnh |
| YC9 | Firebase email/password, backend xác minh ID token, hồ sơ/quyền trong Firestore |

## Chạy nhanh

1. Bấm đúp `BAT_DAU_WEB.cmd`.
2. Mở <http://localhost:1880/>.
3. Nếu chưa cấu hình Firebase, có thể **Đăng ký** tài khoản cục bộ hoặc chọn **Vào chế độ cục bộ** để dùng tài khoản Demo.

Tài khoản cục bộ có UID và hồ sơ riêng. Mật khẩu được băm bằng `scrypt` ở Node-RED; trình duyệt chỉ lưu token phiên. Dữ liệu tài khoản nằm trong `nodered/data/` và đã bị Git bỏ qua. Đây là phương án dùng trong mạng LAN; khi triển khai Internet nên cấu hình Firebase Authentication và tắt cả `AQUA_ALLOW_LOCAL_AUTH` lẫn `AQUA_ALLOW_DEMO_AUTH`.

Các địa chỉ:

- Web quản lý: <http://localhost:1880/>
- Node-RED Editor: <http://localhost:1880/red>
- Dashboard kỹ thuật: <http://localhost:1880/dashboard/aquarium>
- MQTT Broker: `broker.hivemq.com:1883`
- Node-RED Client ID: `nodered-hcmus-aqua-18`

Điện thoại cùng Wi‑Fi mở `http://IP_MAY_TIN:1880/`. Xem IPv4 bằng `ipconfig`; chỉ cần cho phép Node.js qua Windows Firewall ở mạng **Private**. ESP32 không còn phụ thuộc IP của máy tính để gửi MQTT.

## Cấu hình Firebase, Telegram và AI

1. Bấm đúp `TAO_CAU_HINH.cmd`. Script tạo `config.local.ps1` từ mẫu và mở Notepad.
2. Điền các biến cần dùng rồi lưu.
3. Dừng và mở lại `BAT_DAU_WEB.cmd`.

`config.local.ps1`, service-account JSON và dữ liệu runtime đã được `.gitignore`; không gửi chúng lên GitHub.

### Firebase Authentication + Firestore

Trong Firebase Console:

1. Tạo project và Web App, chép cấu hình Web vào sáu biến `FIREBASE_*`.
2. Authentication → Sign-in method → bật **Email/Password**.
3. Firestore Database → tạo database.
4. Project settings → Service accounts → **Generate new private key**.
5. Lưu JSON ngoài thư mục public, đặt đường dẫn tuyệt đối vào `FIREBASE_SERVICE_ACCOUNT_PATH`.
6. Khi thử xong, đặt `AQUA_ALLOW_LOCAL_AUTH=false` và `AQUA_ALLOW_DEMO_AUTH=false` để buộc đăng nhập Firebase.

Frontend chỉ nhận cấu hình Firebase Web công khai. Private key Admin, Telegram token và khóa AI chỉ được đọc ở backend. ID token gửi bằng header `Authorization: Bearer ...` và được Firebase Admin xác minh trước khi trả dashboard.

### Telegram

1. Nhắn `@BotFather`, tạo bot và lấy token.
2. Điền `TELEGRAM_BOT_TOKEN` vào `config.local.ps1` rồi khởi động lại hệ thống. Không cần tự tìm `chat_id`.
3. Trên trang **Cảnh báo**, nhấn **Nhận thông báo từ Telegram**. Website tạo deep-link một lần và mở đúng bot.
4. Người dùng phải bấm **Start** trong Telegram. Backend poll Bot API, xác nhận token một lần, ghi `chat_id` vào kho backend/Firestore và liên kết với UID đang đăng nhập.
5. Bật công tắc Telegram rồi dùng **Gửi cảnh báo thử**. Cảnh báo thử chỉ gửi tới Telegram của người đang đăng nhập; cảnh báo hệ thống gửi tới mọi tài khoản đã chủ động liên kết.
6. Có thể nhấn **Hủy liên kết** để xóa người nhận. `TELEGRAM_CHAT_ID` chỉ còn là tùy chọn tương thích cách cấu hình một người nhận cố định trước đây.

Telegram không cho website tự đọc ID chỉ bằng cách mở ứng dụng. Việc người dùng bấm **Start** là bước đồng ý bắt buộc. Token deep-link hết hạn sau 10 phút, chỉ dùng một lần; raw Telegram ID và Bot token không được trả về frontend.

### OpenAI hoặc endpoint tương thích

Điền `OPENAI_API_KEY`; có thể đổi `OPENAI_MODEL`. Nếu dùng khóa OpenAI chính thức, để trống `OPENAI_BASE_URL`. Nếu nhà cung cấp khóa yêu cầu một endpoint OpenAI-compatible riêng, đặt URL HTTPS đó vào `OPENAI_BASE_URL`.

Ví dụ cấu hình cục bộ theo tài liệu CCPro do chủ dự án cung cấp:

```powershell
$env:OPENAI_BASE_URL = "https://api.ccpro.cn/v1"
$env:OPENAI_MODEL = "gpt-5.4"
```

CCPro là dịch vụ trung gian bên thứ ba, không phải endpoint OpenAI chính thức. Tài khoản đang dùng đã được kiểm thử với model `gpt-5.4`; `gpt-5.4-nano` bị CCPro trả về `model_not_found`. Khi cấu hình URL trên, câu hỏi, lịch sử hội thoại giới hạn và ngữ cảnh cảm biến mô tả bên dưới sẽ được gửi tới CCPro. Website hiển thị đúng tên nhà cung cấp đang hoạt động. Không chạy lệnh cài đặt từ xa dạng `irm ... | iex`; chỉ cấu hình biến môi trường thủ công và không commit `config.local.ps1`.

Backend dùng Responses API theo mô hình chỉ đọc:

- Mỗi câu hỏi nhận tối đa 10 tin nhắn trước đó để hội thoại nhiều lượt nhưng không làm phình chi phí.
- Ngữ cảnh gồm dữ liệu mới nhất, tối đa 120 bản ghi trong 24 giờ, 10 cảnh báo gần nhất, ngưỡng và trạng thái relay/kết nối.
- pH/NTU chưa hiệu chuẩn không được suy diễn từ RAW hoặc điện áp.
- Chatbot không có quyền điều khiển relay, đổi ngưỡng hoặc gửi Telegram.
- Request đặt `store: false`; khóa API chỉ ở backend. Mã người dùng gửi cho cơ chế an toàn được băm một chiều.
- Mặc định tối đa 12 câu/phút cho mỗi tài khoản; chỉnh bằng `CHAT_RATE_LIMIT_MAX` và `CHAT_RATE_LIMIT_WINDOW_MS`.

Nếu thiếu key, key sai, hết quota, timeout hoặc nhà cung cấp AI tạm lỗi, trang chat tự chuyển sang bộ trả lời cục bộ và hiển thị đúng lý do. `OPENAI_BASE_URL` không hợp lệ cũng bị chặn thay vì âm thầm gửi key sang endpoint khác. Sau khi sửa `config.local.ps1`, phải dừng rồi mở lại hệ thống để Node-RED nhận biến môi trường mới.

## MQTT

| Topic | Chiều | Nội dung |
|---|---|---|
Topic root: `aqua-iot/nhom18-24127175-24127257/esp32-aqua-01`

| Topic con | ESP32/Node-RED | Nội dung |
|---|---|---|
| `/data` | ESP32 → Node-RED | nhiệt độ, RAW/điện áp pH và độ đục, cảnh báo độ đục, relay, mode, RSSI |
| `/status` | ESP32 → Node-RED | `online`/`offline`, retained/LWT |
| `/command` | Node-RED → ESP32 | `ON`, `OFF`, `MODE`; `MANUAL`/`AUTO` |

HiveMQ Public dùng `broker.hivemq.com:1883`; `BAT_DAU_WEB.cmd` chỉ khởi chạy Node-RED, không chạy Mosquitto. Broker này không yêu cầu tài khoản và chỉ dành cho học tập/thử nghiệm: message có thể bị người khác đọc hoặc gửi giả. Không truyền mật khẩu/dữ liệu nhạy cảm và không nối relay với tải nguy hiểm. Khi triển khai thật, chuyển sang broker Cloud riêng có TLS và tài khoản.

## Nạp firmware ESP32

1. Cài `PubSubClient`, `OneWire`, `DallasTemperature`, `Adafruit GFX`, `Adafruit SSD1306`.
2. Mở `firmware/aqua_iot_nodered/aqua_iot_nodered.ino`.
3. Điền `AQUA_WIFI_SSID` và `AQUA_WIFI_PASSWORD`; giữ broker `broker.hivemq.com`, cổng `1883` và topic root giống Node-RED.
4. Chọn **ESP32 Dev Module**, đúng COM, rồi Upload.
5. Serial Monitor 115200 baud để xem kết nối và telemetry.

Sơ đồ chân: DS18B20 GPIO13; pH GPIO34; độ đục GPIO35; LED xanh/đỏ GPIO18/19 qua 330Ω; relay GPIO26; OLED SDA22/SCL23 địa chỉ 0x3C. Hai analog dùng cầu chia module → 20kΩ → ADC → 4,7kΩ → GND.

Ngưỡng độ đục mặc định trong firmware là điện áp module `< 2,50 V`; đây chỉ là điểm bắt đầu, cần hiệu chuẩn bằng mẫu nước thật. Chế độ AUTO hiện được truyền và hiển thị nhưng không tự bật relay vì proposal chưa xác định quy tắc an toàn. pH cũng phải hiệu chuẩn trước khi web hiển thị/Telegram cảnh báo pH.

## API backend

- `GET /api/config` — cấu hình công khai và trạng thái tính năng.
- `GET /api/dashboard?hours=24` — telemetry, lịch sử, cảnh báo, cấu hình, hồ sơ.
- `POST /api/action` — `relay`, `mode`, `settings`, `profile`, `chat`, `telegramConnect`, `telegramStatus`, `telegramDisconnect`, `testAlert`.
- `GET /api/health` — trạng thái backend/persistence.

## Dừng hệ thống

Bấm đúp `DUNG_WEB.cmd`, hoặc chạy:

```powershell
.\nodered\stop-aqua-iot.ps1
```
