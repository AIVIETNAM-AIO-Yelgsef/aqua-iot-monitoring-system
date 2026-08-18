# MQTT Contract

Tài liệu này là contract MQTT chính thức cho `aqua-iot-selfcode`. Firmware,
backend và website phải dùng đúng topic và payload được mô tả bên dưới.

## 1. Nguyên tắc chung

- MQTT broker: `broker.hivemq.com`
- MQTT port: `1883`
- Topic gốc: `aqua-iot/nhom18/<deviceId>`
- `deviceId` nằm trong topic, không lặp lại trong telemetry payload.
- Backend lấy `deviceId` từ topic MQTT và tự tạo `timestamp` khi nhận dữ liệu.
- Website giao tiếp với backend; website không kết nối trực tiếp đến MQTT broker.

Ví dụ với Device ID `aqua-20500de64424`:

```text
aqua-iot/nhom18/aqua-20500de64424
```

## 2. Danh sách topic

| Topic suffix | Hướng | Nội dung |
| --- | --- | --- |
| `/telemetry` | ESP32 → Backend | Dữ liệu cảm biến và trạng thái thực tế |
| `/status` | ESP32 → Backend | Trạng thái kết nối `online` hoặc `offline` |
| `/relay/set` | Backend → ESP32 | Lệnh bật hoặc tắt relay |

## 3. Telemetry

Topic:

```text
aqua-iot/nhom18/<deviceId>/telemetry
```

Ví dụ:

```text
aqua-iot/nhom18/aqua-20500de64424/telemetry
```

Payload:

```json
{
  "temperature": 27.5,
  "ph": null,
  "relayOn": false
}
```

Quy ước field:

| Field | Kiểu | Quy ước |
| --- | --- | --- |
| `temperature` | number hoặc null | Nhiệt độ nước theo độ C; `null` khi không đọc được |
| `ph` | number hoặc null | Giá trị pH đã hiệu chuẩn; `null` khi chưa có giá trị đáng tin cậy |
| `relayOn` | boolean | Trạng thái relay thực tế tại ESP32 |

Cấu hình publish:

```text
QoS: 0
Retain: false
Chu kỳ đề xuất: 3-5 giây
```

ESP32 không gửi `timestamp`. Backend gắn thời gian khi nhận được telemetry.

## 4. Trạng thái thiết bị

Topic:

```text
aqua-iot/nhom18/<deviceId>/status
```

Payload khi kết nối thành công:

```text
online
```

Payload khi mất kết nối:

```text
offline
```

Cấu hình:

```text
QoS: 1
Retain: true
Last Will payload: offline
```

ESP32 phải khai báo Last Will `offline` trước khi kết nối MQTT. Sau khi kết nối
thành công, ESP32 publish `online` với retain được bật.

## 5. Lệnh điều khiển relay

Topic:

```text
aqua-iot/nhom18/<deviceId>/relay/set
```

Bật relay:

```json
{
  "relayOn": true
}
```

Tắt relay:

```json
{
  "relayOn": false
}
```

Cấu hình publish:

```text
QoS: 1
Retain: false
```

Sau khi nhận lệnh, ESP32 điều khiển relay và publish trạng thái `relayOn` thực
tế trong gói `/telemetry` tiếp theo. Website không tự giả định lệnh đã thành
công chỉ dựa trên HTTP response.

## 6. Luồng dữ liệu

Telemetry:

```text
Cảm biến → ESP32 → MQTT /telemetry → Backend → API → Website
```

Điều khiển relay:

```text
Website → Backend → MQTT /relay/set → ESP32 → Relay
                                              |
Website ← Backend ← MQTT /telemetry ←─────────+
```

Telemetry là nguồn sự thật cho `relayOn`. Lệnh điều khiển chỉ thể hiện mong
muốn của người dùng, không phải trạng thái đã được ESP32 thực thi.

## 7. Topic wildcard cho backend

Backend subscribe các topic:

```text
aqua-iot/nhom18/+/telemetry
aqua-iot/nhom18/+/status
```

ESP32 subscribe các topic của chính nó:

```text
aqua-iot/nhom18/<deviceId>/relay/set
```
