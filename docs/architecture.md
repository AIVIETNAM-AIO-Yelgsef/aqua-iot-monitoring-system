# Kiến trúc hệ thống Aqua IoT

Tài liệu này mô tả đúng kiến trúc đang được cài đặt trong repository. Dự án được tổ chức theo hướng đơn giản, phù hợp với đồ án sinh viên: ESP32 xử lý phần cứng, Node-RED làm trung tâm, website chỉ gọi API và MQTT sử dụng broker công khai.

## 1. Sơ đồ tổng thể

```text
ESP32 <---- MQTT ----> HiveMQ Public <----> Node-RED <---- HTTP ----> Website
  |                                                |                    |
  +-- Cảm biến, OLED, LED, relay                   +-- JSON cục bộ      +-- Firebase Auth
                                                   +-- Firestore
                                                   +-- Telegram
                                                   +-- OpenAI
```

Luồng dữ liệu chính:

```text
Cảm biến -> ESP32 -> MQTT -> Node-RED -> Dashboard / Website
Website hoặc Dashboard -> Node-RED -> MQTT -> ESP32 -> Relay
```

Node-RED là thành phần trung tâm. Website không kết nối trực tiếp tới MQTT, Firebase Admin, Telegram hoặc OpenAI. Khi bật Firebase Authentication, website kết nối trực tiếp tới Firebase Auth để đăng nhập rồi gửi ID token cho Node-RED xác minh.

## 2. Cấu trúc repository

```text
firmware/
  aqua_iot_nodered/aqua_iot_nodered.ino  Firmware ESP32

nodered/
  flows.json                             Bốn flow Node-RED
  settings.js                            Cấu hình Node-RED và static website
  lib/aqua-services.js                   Logic dùng chung của các Function node
  data/aqua-local.json                   Dữ liệu runtime cục bộ, không đưa lên Git

website/
  index.html                             Giao diện chính
  styles.css                             Giao diện responsive
  backend-client.js                      Gọi API và xử lý đăng nhập
  app.js                                 Hiển thị dữ liệu và xử lý tương tác

docs/
  architecture.md                        Tài liệu kiến trúc này
```

File `nodered/data/aqua-local.json` được tạo khi chạy. Có thể đổi vị trí bằng biến `AQUA_LOCAL_DATA_PATH`.

## 3. Trách nhiệm của từng thành phần

### ESP32

- Đọc nhiệt độ DS18B20.
- Đọc tín hiệu analog của cảm biến pH và độ đục.
- Hiển thị dữ liệu trên OLED.
- Cảnh báo độ đục tại chỗ bằng LED xanh/đỏ và OLED.
- Kết nối Wi-Fi và HiveMQ Public.
- Gửi telemetry mỗi 3 giây khi MQTT đang kết nối.
- Gửi trạng thái `online`; sử dụng Last Will `offline` khi mất kết nối.
- Nhận lệnh MQTT để bật/tắt relay hoặc đổi chế độ MANUAL/AUTO.
- Tiếp tục đo cảm biến và cảnh báo tại chỗ khi mất Internet.

### Node-RED

- Subscribe telemetry và trạng thái thiết bị từ MQTT.
- Kiểm tra, chuẩn hóa và lưu dữ liệu.
- Cập nhật Dashboard kỹ thuật theo thời gian thực.
- Cung cấp API cho website.
- Gửi lệnh điều khiển từ Dashboard hoặc website tới ESP32.
- Kiểm tra ngưỡng nhiệt độ và pH.
- Lưu JSON cục bộ và đồng bộ Firestore nếu được cấu hình.
- Gửi Telegram và gọi OpenAI nếu có khóa tương ứng.

### Website

- Được Node-RED phục vụ tại `/`.
- Gọi API Node-RED, không subscribe MQTT trực tiếp.
- Hiển thị dữ liệu hiện tại, lịch sử, biểu đồ, cảnh báo và trạng thái relay.
- Gửi lệnh relay, đổi chế độ, lưu ngưỡng và hồ sơ.
- Hỗ trợ Firebase Authentication hoặc chế độ demo cục bộ.
- Dùng Chart.js được phục vụ tại `/vendor/chartjs`.
- Poll API dashboard mỗi 3 giây.

## 4. Bốn flow Node-RED

File flow duy nhất là `nodered/flows.json`. Khi chạy `npm start`, Node-RED tự khởi động cả bốn flow cùng lúc.

```text
01 - MQTT Ingest
  telemetry.valid ------> 02 - Realtime Dashboard
  device.status --------> 02 - Realtime Dashboard

02 - Realtime Dashboard
  command.from.dashboard -> 03 - Device Control

04 - Web API
  command.from.api ------> 03 - Device Control

03 - Device Control
  command ---------------> MQTT -> ESP32
```

| Flow | Nội dung đang thực hiện |
|---|---|
| `01 - MQTT Ingest` | Nhận telemetry/status, parse JSON, chuẩn hóa, lưu lịch sử và phát hiện cảnh báo. |
| `02 - Realtime Dashboard` | Hiển thị gauge, text, chart, trạng thái MQTT và nhận thao tác relay từ Dashboard kỹ thuật. |
| `03 - Device Control` | Gộp lệnh từ Dashboard và Web API rồi publish tới topic command. |
| `04 - Web API` | Cung cấp `/api/config`, `/api/dashboard`, `/api/action` và `/api/health`. |

Các flow trao đổi qua bốn Link node:

- `telemetry.valid`
- `device.status`
- `command.from.dashboard`
- `command.from.api`

Các Function node trên canvas chỉ có một dòng gọi hàm tương ứng trong `nodered/lib/aqua-services.js`. Cách tổ chức này giữ flow dễ nhìn và tránh chép lại cùng một logic ở nhiều node.

## 5. Địa chỉ khi chạy

Port mặc định là `1880`, có thể đổi bằng biến `PORT`.

| Thành phần | Địa chỉ |
|---|---|
| Website quản lý | `http://localhost:1880/` |
| Node-RED Editor | `http://localhost:1880/red` |
| Dashboard kỹ thuật | `http://localhost:1880/dashboard/aquarium` |
| Public config API | `http://localhost:1880/api/config` |
| Dashboard API | `http://localhost:1880/api/dashboard` |
| Action API | `http://localhost:1880/api/action` |
| Health API | `http://localhost:1880/api/health` |

## 6. MQTT

### Broker

- Broker mặc định: `broker.hivemq.com`
- Port: `1883`
- Không dùng username/password.
- Node-RED đọc host, port và client ID từ `.env`.
- Firmware hiện khai báo broker trực tiếp trong file `.ino`.

Đây là broker công khai dành cho học tập và demo. Không gửi mật khẩu, token hoặc dữ liệu nhạy cảm qua MQTT.

### Topic

Device ID hiện tại là `hcmus-aqua-18`.

| Topic | Hướng | QoS/retain | Nội dung |
|---|---|---|---|
| `aquaiot/hcmus-aqua-18/telemetry` | ESP32 → Node-RED | QoS 0, không retain | Dữ liệu cảm biến và trạng thái relay. |
| `aquaiot/hcmus-aqua-18/status` | ESP32 → Node-RED | QoS 1, retain | `online` hoặc Last Will `offline`. |
| `aquaiot/hcmus-aqua-18/command` | Node-RED → ESP32 | QoS 1, không retain | Lệnh relay hoặc chế độ điều khiển. |

### Telemetry do firmware gửi

```json
{
  "deviceId": "hcmus-aqua-18",
  "temperature": 27.5,
  "turbidityRaw": 1234,
  "turbidityVoltage": 2.45,
  "turbidityAlert": true,
  "phRaw": 1850,
  "phVoltage": 2.31,
  "ph": 7.12,
  "phCalibrated": true,
  "relayStatus": "OFF",
  "controlMode": "MANUAL",
  "rssi": -55
}
```

Backend chấp nhận thêm một số tên tương đương như `temperatureC`, `pH`, `relay`, `aerator`, `wifiRssi`, `ntu`, `poVoltage` và `aoVoltage`.

Sau khi chuẩn hóa, backend bổ sung:

- `id`
- `timestamp`, `timestampMs`, `receivedAt`
- `temperatureValid`
- `phCalibrated`
- `relayOn`
- các trường ADC/điện áp nếu payload có cung cấp

### Lệnh điều khiển

Lệnh từ Node-RED có dạng:

```json
{
  "deviceId": "hcmus-aqua-18",
  "command": "ON",
  "mode": "MANUAL",
  "requestId": "web-..."
}
```

Firmware chấp nhận:

- Chuỗi `ON`, `OFF`, `1`, `0`.
- Chuỗi `AUTO`, `MANUAL`.
- JSON có `command` là `ON`, `OFF` hoặc `MODE` và `mode` là `AUTO`/`MANUAL`.

Lệnh ON/OFF luôn chuyển relay về MANUAL. Lệnh đổi chế độ chỉ đổi trạng thái chế độ và giữ nguyên relay.

## 7. Xử lý và lưu dữ liệu

### Dữ liệu mới nhất

Mọi telemetry hợp lệ đều cập nhật `state.latest` để Dashboard nhận giá trị mới nhất.

### Lịch sử

- Firmware gửi telemetry khoảng 3 giây/lần.
- Backend mặc định chỉ lưu một bản ghi lịch sử mỗi 60 giây cho mỗi thiết bị.
- Chu kỳ lưu được đổi bằng `CLOUD_SAVE_INTERVAL_MS`.
- Kho cục bộ giữ tối đa 10.000 bản ghi telemetry gần nhất.
- API cho phép đọc từ 1 đến 2.160 giờ và tối đa 1.000 bản ghi mỗi lần.
- Nếu Firestore có dữ liệu, API ưu tiên lịch sử Firestore; nếu lỗi hoặc trống thì dùng JSON cục bộ.

### File JSON cục bộ

File mặc định: `nodered/data/aqua-local.json`.

```text
latest       Telemetry mới nhất
telemetry    Lịch sử cảm biến
alerts       Danh sách cảnh báo
activity     Lịch sử lệnh relay/chế độ
settings     Ngưỡng và cấu hình
profiles     Hồ sơ người dùng
mqttStatus   Trạng thái MQTT gần nhất
```

JSON cục bộ luôn được dùng làm fallback, kể cả khi Firebase đã được cấu hình.

### Firestore

| Collection/document | Dữ liệu |
|---|---|
| `aquaTelemetry/{id}` | Telemetry đã lưu theo chu kỳ. |
| `aquaAlerts/{id}` | Cảnh báo tự động và cảnh báo thử. |
| `aquaActivity/{id}` | Lệnh relay và lệnh đổi chế độ. |
| `aquaProfiles/{uid}` | Hồ sơ người dùng. |
| `aquaSystem/settings` | Ngưỡng, Telegram và chế độ điều khiển. |

Nếu Firestore lỗi, backend ghi nhận lỗi và tiếp tục trả dữ liệu cục bộ.

## 8. Cảnh báo

Ngưỡng mặc định của backend:

| Giá trị | Mặc định |
|---|---:|
| Nhiệt độ tối thiểu | 24 °C |
| Nhiệt độ tối đa | 30 °C |
| pH tối thiểu | 6,5 |
| pH tối đa | 8,0 |
| Cooldown | 600.000 ms (10 phút) |

Backend tạo cảnh báo khi:

- Nhiệt độ thấp hơn hoặc cao hơn ngưỡng.
- pH thấp hơn hoặc cao hơn ngưỡng và `phCalibrated` là `true`.

Cooldown được tính riêng theo thiết bị, chỉ số và hướng vượt ngưỡng. Cảnh báo được lưu cục bộ, lưu Firestore nếu có và gửi Telegram nếu được bật.

Cảnh báo độ đục trong firmware là một chức năng riêng:

- Mặc định so sánh điện áp module với ngưỡng `2,50 V`.
- Điện áp thấp hơn ngưỡng được xem là nước đục.
- LED xanh báo bình thường; LED đỏ nhấp nháy khi cảnh báo.
- Cảnh báo này hoạt động tại ESP32 và không phụ thuộc Internet.
- Backend hiện chưa tạo Telegram từ trường `turbidityAlert`.

## 9. Web API

Mọi response JSON đều đặt `Cache-Control: no-store`.

### `GET /api/config`

Không yêu cầu đăng nhập. Trả về:

- Phiên bản service.
- Firebase Web config công khai nếu đủ biến môi trường.
- Chế độ xác thực.
- Trạng thái các tính năng Firebase, Telegram, OpenAI, MQTT và hiệu chuẩn.

### `GET /api/dashboard?hours=24&limit=360`

Trả về:

```text
latest       Dữ liệu mới nhất
history      Lịch sử theo khoảng thời gian
alerts       Tối đa 50 cảnh báo gần nhất
settings     Ngưỡng và cấu hình
profile      Hồ sơ người dùng
status       Online, MQTT, RSSI và persistence
features     Các dịch vụ đang sẵn sàng
serverTime   Thời gian backend
```

`hours` được giới hạn từ 1 đến 2.160; `limit` từ 1 đến 1.000.

### `POST /api/action`

Body chung:

```json
{
  "action": "relay"
}
```

Các action đang hỗ trợ:

| Action | Dữ liệu chính | Kết quả |
|---|---|---|
| `relay` | `command`, `state`, `value` hoặc `on` | Gửi ON/OFF và chuyển MANUAL. |
| `mode` | `mode` hoặc `value` | Gửi AUTO/MANUAL. |
| `settings` | Ngưỡng, Telegram, mode | Lưu cấu hình. |
| `profile` | `name`, `pondName` | Lưu hồ sơ. |
| `chat` | `question` hoặc `message` | Trả lời bằng OpenAI hoặc câu trả lời cục bộ. |
| `testAlert` | Không bắt buộc | Tạo và có thể gửi cảnh báo thử. |

Tài khoản có role `viewer` không được dùng relay, mode, settings, profile và test alert.

### `GET /api/health`

Không yêu cầu đăng nhập. Trả trạng thái backend, thiết bị, persistence và các dịch vụ tùy chọn.

## 10. Xác thực

Hệ thống có hai chế độ:

### Chế độ demo

- Được dùng khi Firebase Admin chưa cấu hình và `AQUA_ALLOW_DEMO_AUTH=true`.
- Phiên demo được lưu trong `sessionStorage` hoặc `localStorage` của trình duyệt.
- Backend xem người dùng là `demo`.
- Đây không phải cơ chế bảo mật cho môi trường thật.

### Firebase Authentication

Cần đồng thời cấu hình:

1. Firebase Web App để website đăng nhập.
2. Firebase Admin SDK để backend xác minh ID token.

Website gửi token qua header:

```text
Authorization: Bearer <Firebase ID token>
```

Backend hỗ trợ role `admin`, `user` và `viewer`. Role `viewer` được đọc từ `aquaProfiles/{uid}`.

## 11. Cấu hình `.env`

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `PORT` | Port Node-RED | `1880` |
| `NODE_RED_CREDENTIAL_SECRET` | Khóa mã hóa credential Node-RED | Không có |
| `AQUA_ALLOW_DEMO_AUTH` | Cho phép đăng nhập demo | `true` |
| `AQUA_LOCAL_DATA_PATH` | Đường dẫn file JSON | `nodered/data/aqua-local.json` |
| `CLOUD_SAVE_INTERVAL_MS` | Chu kỳ lưu lịch sử | `60000` |
| `ALERT_COOLDOWN_MS` | Cooldown cảnh báo | `600000` |
| `DEVICE_OFFLINE_MS` | Thời gian xác định thiết bị offline | `45000` |
| `MQTT_BROKER_HOST` | Broker Node-RED | `broker.hivemq.com` |
| `MQTT_BROKER_PORT` | Port MQTT | `1883` |
| `MQTT_CLIENT_ID` | Client ID của Node-RED | `nodered-hcmus-aqua-18` |
| `FIREBASE_*` | Firebase Web App | Để trống |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | File service account | Để trống |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account dạng JSON | Để trống |
| `FIREBASE_USE_APPLICATION_DEFAULT` | Dùng Application Default Credentials | `false` |
| `TELEGRAM_BOT_TOKEN` | Token Telegram bot | Để trống |
| `TELEGRAM_CHAT_ID` | Chat nhận cảnh báo | Để trống |
| `OPENAI_API_KEY` | OpenAI API key | Để trống |
| `OPENAI_MODEL` | Model chatbot | `gpt-5.4-nano` |

Biến `FIREBASE_CHECK_REVOKED_TOKENS` có trong `.env.example` nhưng code hiện tại chưa sử dụng khi gọi `verifyIdToken`.

## 12. Phần cứng và chân kết nối

| Thiết bị | ESP32 |
|---|---:|
| DS18B20 | GPIO13 |
| Cảm biến pH | GPIO34 |
| Cảm biến độ đục | GPIO35 |
| LED xanh | GPIO18 |
| LED đỏ | GPIO19 |
| Relay | GPIO26 |
| OLED SDA | GPIO22 |
| OLED SCL | GPIO23 |
| OLED address | `0x3C` |

Hai tín hiệu analog sử dụng cầu chia áp với hệ số quy đổi `5,2553`. ADC được đặt 12 bit và attenuation `ADC_11db`.

### Hiệu chuẩn pH hai điểm

Firmware tính pH bằng đường thẳng đi qua hai điểm chuẩn pH 4 và pH 7:

1. Ngâm đầu dò trong dung dịch pH 4, chờ ổn định và ghi lại `phVoltage` trên Serial Monitor.
2. Rửa đầu dò bằng nước cất.
3. Ngâm đầu dò trong dung dịch pH 7, chờ ổn định và ghi lại `phVoltage`.
4. Thay hai số đo vào `PH4_VOLTAGE` và `PH7_VOLTAGE` trong firmware.
5. Nạp lại firmware và kiểm tra payload có `ph` cùng `phCalibrated: true`.

Giá trị `3,00 V` và `2,50 V` trong code chỉ là giá trị khởi đầu. Muốn pH chính xác phải thay bằng điện áp đo từ chính module và điện cực đang sử dụng.

Firmware giới hạn kết quả trong miền pH 0–14. Nếu tắt `PH_CALIBRATED` hoặc hai điện áp chuẩn không hợp lệ, firmware gửi `ph: null`.

Relay hiện dùng logic active HIGH:

- `HIGH`: bật relay.
- `LOW`: tắt relay.
- Khi khởi động, firmware đặt relay về tắt.

## 13. Trạng thái online/offline

Backend xem thiết bị online khi thỏa một trong hai điều kiện:

- MQTT status gần nhất là `online`.
- Có telemetry mới trong khoảng `DEVICE_OFFLINE_MS`, mặc định 45 giây.

Firmware publish status `online` dạng retained. Nếu mất MQTT ngoài ý muốn, broker publish Last Will `offline`.

## 14. Giới hạn hiện tại của code

- Công thức pH đã có, nhưng hai hằng số `PH4_VOLTAGE` và `PH7_VOLTAGE` vẫn phải được thay bằng số đo thực tế của đầu dò.
- Firmware chưa tính NTU đã hiệu chuẩn; hệ thống chủ yếu hiển thị RAW và điện áp độ đục.
- Chế độ AUTO mới chỉ được truyền, lưu và hiển thị; chưa có quy tắc tự động bật/tắt relay.
- Dashboard kỹ thuật Node-RED gửi lệnh relay trực tiếp qua MQTT, không đi qua xác thực của Web API.
- Node-RED Editor và Dashboard kỹ thuật chưa được bảo vệ bằng `adminAuth`.
- HiveMQ Public không có bảo mật riêng cho topic của dự án.
- Chế độ demo chỉ phù hợp để học tập và trình diễn.
- File JSON được ghi đồng bộ; phù hợp quy mô đồ án nhỏ, không dành cho tải lớn.

Các giới hạn trên là chủ ý của phiên bản hiện tại để giữ project đơn giản và đúng phạm vi đồ án.

## 15. Khởi động hệ thống

```bash
cp .env.example .env
cd nodered
npm install
npm start
```

Node-RED đọc `settings.js`, nạp `flows.json`, khởi động cả bốn flow, phục vụ website và kết nối HiveMQ Public.

Nếu cổng `1880` đang được sử dụng, có thể đổi cổng:

```bash
PORT=1881 npm start
```

Sau khi thay đổi `flows.json`, `settings.js`, `.env` hoặc `aqua-services.js`, cần khởi động lại Node-RED để nạp cấu hình mới.
