# Firmware ESP32 Aqua IoT

Sketch chính: `aqua_iot_nodered/aqua_iot_nodered.ino`.

## 1. Sơ đồ chân đang dùng

| Thiết bị | Chân thiết bị | ESP32 / nguồn | Ghi chú |
|---|---|---|---|
| DS18B20 | `DAT` | `GPIO13` | Module terminal hiện có sẵn điện trở `4.7 kΩ`; nếu dùng đầu dò trần thì mắc thêm `DAT → 4.7 kΩ → 3.3V` |
| DS18B20 | `VCC` | `3.3V` | Không đảo VCC/GND |
| DS18B20 | `GND` | `GND` | GND chung |
| Module độ đục | `V` | `5V` | Đầu dò cắm vào đầu nối của module |
| Module độ đục | `G` | `GND` | GND chung |
| Module độ đục | `A/AO` | cầu chia áp → `GPIO35` | `D/DO` không dùng |
| Module pH | `V+` | `5V` | BNC nối đầu dò pH |
| Module pH | một trong hai chân `G` | `GND` | `To/Do` không dùng |
| Module pH | `Po` | cầu chia áp → `GPIO34` | Không nối Po thẳng vào ESP32 |
| OLED SSD1306 | `VCC` | `3.3V` | Địa chỉ I2C `0x3C` |
| OLED SSD1306 | `GND` | `GND` | GND chung |
| OLED SSD1306 | `SDA` | `GPIO22` | Theo dây đã kiểm thử |
| OLED SSD1306 | `SCL` | `GPIO23` | Theo dây đã kiểm thử |
| LED xanh | anode qua `330 Ω` | `GPIO18` | Cathode xuống GND |
| LED đỏ | anode qua `330 Ω` | `GPIO19` | Cathode xuống GND |
| Relay | `DC+` | `5V` | Đặt jumper ở `H` |
| Relay | `DC-` | `GND` | GND chung với ESP32 |
| Relay | `IN` | `GPIO26` | HIGH = bật, LOW = tắt |

Hai cầu chia áp analog phải mắc giống nhau:

```text
AO độ đục hoặc Po pH ── 20 kΩ ──●── GPIO35 hoặc GPIO34
                                 │
                               4.7 kΩ
                                 │
                                GND
```

Với cách mắc này, điện áp tại GPIO bằng khoảng `4.7 / (20 + 4.7) = 19%` điện áp module. Không cấp tín hiệu 5 V trực tiếp vào GPIO34/GPIO35.

## 2. Thư viện Arduino

Cài trong **Library Manager**:

- `PubSubClient`
- `OneWire`
- `DallasTemperature`
- `Adafruit GFX Library`
- `Adafruit SSD1306`

Board package: **esp32 by Espressif Systems**. Chọn board **ESP32 Dev Module** và đúng cổng COM của CP210x.

## 3. Cấu hình trước khi nạp

Trong thư mục `aqua_iot_nodered`, sao chép file mẫu:

```text
aqua_secrets.example.h -> aqua_secrets.h
```

Sau đó chỉ sửa các giá trị trong `aqua_secrets.h`:

```cpp
#define AQUA_WIFI_SSID "AQUA_IOT"
#define AQUA_WIFI_PASSWORD "MAT_KHAU_WIFI_CUA_BAN"
#define AQUA_MQTT_HOST "broker.hivemq.com"
#define AQUA_MQTT_PORT 1883
#define AQUA_MQTT_TOPIC_ROOT "aqua-iot/nhom18-24127175-24127257/esp32-aqua-01"
```

`aqua_secrets.h` đã được `.gitignore` loại trừ nên mật khẩu Wi-Fi không bị đưa lên Git. Không sửa hoặc ghi mật khẩu thật vào `aqua_secrets.example.h`.

ESP32 và Node-RED cùng kết nối tới `broker.hivemq.com:1883`, vì vậy không cần nhập IPv4 máy tính và không cần chạy Mosquitto cục bộ. Giữ `AQUA_MQTT_TOPIC_ROOT` giống hệt cấu hình Node-RED. ESP32 tự tạo Client ID riêng từ MAC; không dùng Client ID `nodered-hcmus-aqua-18` của Node-RED.

## 4. Nạp và kiểm tra

1. Mở `aqua_iot_nodered.ino` trong Arduino IDE.
2. Chọn **ESP32 Dev Module** và cổng COM đúng.
3. Bấm **Verify**, sau đó **Upload**.
4. Mở Serial Monitor ở `115200 baud`.
5. Chạy `nodered/BAT_DAU_WEB.cmd`, sau đó mở `http://127.0.0.1:1880/`.

Serial phải lần lượt thấy `WiFi OK`, `MQTT: DA KET NOI` và các dòng `MQTT TX`. Nếu cảm biến analog báo quá áp/bão hòa, rút USB ngay rồi kiểm tra lại cầu chia `20 kΩ/4.7 kΩ`.

Nếu sau 30 giây thấy `WiFi timeout`, kiểm tra SSID/mật khẩu, bảo đảm mạng có băng tần **2.4 GHz** và không yêu cầu đăng nhập qua trang web. Firmware mới không gọi `WiFi.begin()` chồng lên lần kết nối đang chạy, nên không còn lặp lỗi `sta is connecting, cannot set config`.

Có thể thử relay từ Serial Monitor:

- `1`: bật relay, chuyển MANUAL
- `0`: tắt relay, chuyển MANUAL
- `A`: chọn AUTO
- `M`: chọn MANUAL

## 5. MQTT tương thích Node-RED

| Topic | Nội dung |
|---|---|
Topic root: `aqua-iot/nhom18-24127175-24127257/esp32-aqua-01`

| Topic con | Nội dung |
|---|---|
| `/data` | JSON nhiệt độ, RAW/điện áp pH và độ đục, cảnh báo, relay, mode, RSSI |
| `/status` | `online` hoặc LWT `offline`, retained |
| `/command` | JSON `ON`, `OFF`, `MODE` từ website |

HiveMQ Public là broker mở phục vụ thử nghiệm. Không gửi dữ liệu nhạy cảm và không dùng nó để điều khiển tải điện nguy hiểm. Bản triển khai thật phải dùng broker riêng có TLS và xác thực.

Firmware lọc lệnh theo `deviceId`, giữ relay tắt khi khởi động và gửi telemetry ngay sau mỗi lệnh để website cập nhật trạng thái thật.

## 6. Hiệu chuẩn và chế độ AUTO

- pH được gửi là `null` và `phCalibrated=false` cho đến khi hiệu chuẩn bằng dung dịch chuẩn. RAW và điện áp Po vẫn được gửi đầy đủ.
- Độ đục hiện dùng RAW/điện áp và ngưỡng cục bộ `2.50 V`; chưa tuyên bố giá trị NTU khi chưa hiệu chuẩn.
- AUTO hiện chỉ là trạng thái giao diện. Firmware không tự bật/tắt máy sủi vì dự án chưa có cảm biến oxy hòa tan và chưa có quy tắc điều khiển đã kiểm chứng. Điều khiển `ON/OFF` từ web luôn là thao tác MANUAL.
