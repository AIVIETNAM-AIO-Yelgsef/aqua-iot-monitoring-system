#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <PubSubClient.h>

// DS18B20
#include <OneWire.h>
#include <DallasTemperature.h>

// OLED SSD1306
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// Pin map
const int TEMPERATURE_PIN = 13;
const int PH_PIN = 34;
const int TURBIDITY_PIN = 35;
const int LED_GREEN_PIN = 18;
const int LED_RED_PIN = 19;
const int RELAY_PIN = 26;
const int OLED_SDA_PIN = 22;
const int OLED_SCL_PIN = 23;

const int OLED_WIDTH = 128;
const int OLED_HEIGHT = 64;
const int OLED_RESET_PIN = -1;
const int OLED_ADDRESS = 0x3C;

// Thay bằng thông tin Wi-Fi 2.4 GHz của bạn trước khi nạp firmware.
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const int WIFI_MAX_CONNECT_ATTEMPTS = 30;

const char *MQTT_HOST = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char *MQTT_TOPIC_PREFIX = "aqua-iot/nhom18";
const unsigned long SENSOR_INTERVAL = 3000;
const unsigned long MQTT_RECONNECT_INTERVAL = 5000;

// Giá trị khởi đầu, cần hiệu chỉnh lại bằng mẫu nước sạch và nước đục thực tế.
// Module đang dùng cho giá trị RAW thấp hơn khi nước đục hơn.
const int TURBIDITY_ALERT_THRESHOLD_RAW = 200;

OneWire oneWire(TEMPERATURE_PIN);
DallasTemperature temperatureSensor(&oneWire);
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET_PIN);
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

String deviceId;
String telemetryTopic;
String statusTopic;
String relayCommandTopic;

float temperature = NAN;
int phRaw = 0;
int turbidityRaw = 0;
bool turbidityAlert = false;
bool relayOn = false;
bool oledReady = false;
unsigned long lastSensorRead = 0;
unsigned long lastMqttReconnect = 0;

void buildDeviceIdentity()
{
  String macAddress = WiFi.macAddress();
  macAddress.replace(":", "");
  macAddress.toLowerCase();

  deviceId = "aqua_device_01";
  String deviceTopic = String(MQTT_TOPIC_PREFIX) + "/" + deviceId;
  telemetryTopic = deviceTopic + "/telemetry";
  statusTopic = deviceTopic + "/status";
  relayCommandTopic = deviceTopic + "/relay/set";

  Serial.print("Device ID: ");
  Serial.println(deviceId);
}

bool connectWiFi()
{
  Serial.print("Đang kết nối Wi-Fi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < WIFI_MAX_CONNECT_ATTEMPTS)
  {
    delay(500);
    Serial.print(".");
    attempt++;
  }

  Serial.println();

  if (WiFi.status() != WL_CONNECTED)
  {
    Serial.println("Không thể kết nối Wi-Fi. Hệ thống tiếp tục chạy offline.");
    return false;
  }

  Serial.println("Đã kết nối Wi-Fi.");
  Serial.print("Địa chỉ IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

bool connectMQTT()
{
  if (WiFi.status() != WL_CONNECTED)
  {
    Serial.println("Chưa có Wi-Fi nên không thể kết nối MQTT.");
    return false;
  }

  Serial.print("Đang kết nối MQTT...");

  bool connected = mqttClient.connect(
      deviceId.c_str(),
      statusTopic.c_str(),
      1,
      true,
      "offline");

  if (!connected)
  {
    Serial.print(" thất bại, mã lỗi: ");
    Serial.println(mqttClient.state());
    return false;
  }

  Serial.println(" thành công.");
  mqttClient.publish(statusTopic.c_str(), "online", true);

  if (mqttClient.subscribe(relayCommandTopic.c_str(), 1))
  {
    Serial.print("Đã subscribe: ");
    Serial.println(relayCommandTopic);
  }
  else
  {
    Serial.println("Không thể subscribe topic điều khiển relay.");
  }

  return true;
}

void publishTelemetry()
{
  if (!mqttClient.connected())
  {
    return;
  }

  String payload = "{\"temperature\":";
  if (isnan(temperature))
  {
    payload += "null";
  }
  else
  {
    payload += String(temperature, 2);
  }

  // pH chỉ được gửi sau khi cảm biến đã hiệu chuẩn.
  payload += ",\"ph\":";
  payload += String(ph);
  payload += ",\"relayOn\":";
  payload += relayOn ? "true" : "false";
  payload += "}";

  bool published = mqttClient.publish(telemetryTopic.c_str(), payload.c_str(), false);

  Serial.print(published ? "Đã gửi MQTT: " : "Gửi MQTT thất bại: ");
  Serial.println(payload);
}

void setRelay(bool turnOn)
{
  relayOn = turnOn;
  digitalWrite(RELAY_PIN, relayOn);

  Serial.print("Relay: ");
  Serial.println(relayOn ? "BẬT" : "TẮT");
}

void mqttCallback(char *topic, byte *payload, unsigned int length)
{
  if (String(topic) != relayCommandTopic)
  {
    return;
  }

  if (length > 64)
  {
    Serial.println("Bỏ qua lệnh relay vì payload quá dài.");
    return;
  }

  String message;
  message.reserve(length);
  for (unsigned int index = 0; index < length; index++)
  {
    message += static_cast<char>(payload[index]);
  }

  message.replace(" ", "");
  message.replace("\n", "");
  message.replace("\r", "");
  message.replace("\t", "");

  Serial.print("Đã nhận lệnh MQTT: ");
  Serial.println(message);

  if (message == "{\"relayOn\":true}")
  {
    setRelay(true);
  }
  else if (message == "{\"relayOn\":false}")
  {
    setRelay(false);
  }
  else
  {
    Serial.println("Payload relay không hợp lệ.");
    return;
  }

  // Gửi lại trạng thái thực tế sau khi ESP32 đã điều khiển relay.
  publishTelemetry();
}

void setup()
{
  Serial.begin(115200);

  pinMode(TEMPERATURE_PIN, INPUT);
  pinMode(PH_PIN, INPUT);
  pinMode(TURBIDITY_PIN, INPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);

  // Khởi động ở trạng thái an toàn: relay và hai LED đều tắt.
  setRelay(false);
  digitalWrite(LED_GREEN_PIN, LOW);
  digitalWrite(LED_RED_PIN, LOW);

  analogReadResolution(12);
  analogSetPinAttenuation(PH_PIN, ADC_11db);
  analogSetPinAttenuation(TURBIDITY_PIN, ADC_11db);

  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);

  oledReady = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
  if (oledReady)
  {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("AQUA IOT");
    display.println("Dang khoi dong...");
    display.display();
  }
  else
  {
    Serial.println("Không tìm thấy OLED tại địa chỉ 0x3C.");
  }

  Serial.println("Aqua IoT đã khởi động.");

  temperatureSensor.begin();
  temperatureSensor.setResolution(11);

  bool wifiConnected = connectWiFi();
  buildDeviceIdentity();

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setKeepAlive(30);
  mqttClient.setCallback(mqttCallback);

  if (wifiConnected)
  {
    connectMQTT();
  }
}

void readTemperature()
{
  temperatureSensor.requestTemperatures();

  float value = temperatureSensor.getTempCByIndex(0);

  if (value == DEVICE_DISCONNECTED_C || value < -55 || value > 125)
  {
    temperature = NAN;
    Serial.println("Không đọc được DS18B20.");
    return;
  }

  temperature = value;

  Serial.print("Nhiệt độ: ");
  Serial.print(temperature);
  Serial.println(" °C");
}

void readAnalogSensors()
{
  phRaw = analogRead(PH_PIN);
  turbidityRaw = analogRead(TURBIDITY_PIN);

  Serial.print("pH RAW: ");
  Serial.println(phRaw);

  Serial.print("Độ đục RAW: ");
  Serial.println(turbidityRaw);
}

void updateTurbidityAlert()
{
  turbidityAlert = turbidityRaw < TURBIDITY_ALERT_THRESHOLD_RAW;

  if (turbidityAlert)
  {
    digitalWrite(LED_GREEN_PIN, LOW);
    digitalWrite(LED_RED_PIN, HIGH);
    Serial.println("Cảnh báo: Nước quá đục.");
  }
  else
  {
    digitalWrite(LED_GREEN_PIN, HIGH);
    digitalWrite(LED_RED_PIN, LOW);
    Serial.println("Độ đục: Bình thường.");
  }
}

void updateOLED()
{
  if (!oledReady)
  {
    return;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);

  display.print("DO DUC CUA NUOC: ");
  display.println(turbidityRaw);
  display.println();
  display.println("Trang thai:");
  display.println(turbidityAlert ? "NUOC QUA DUC" : "BINH THUONG");

  display.display();
}

void loop()
{
  unsigned long currentTime = millis();

  if (WiFi.status() == WL_CONNECTED)
  {
    if (mqttClient.connected())
    {
      mqttClient.loop();
    }
    else if (currentTime - lastMqttReconnect >= MQTT_RECONNECT_INTERVAL)
    {
      lastMqttReconnect = currentTime;
      connectMQTT();
    }
  }

  if (currentTime - lastSensorRead >= SENSOR_INTERVAL)
  {
    lastSensorRead = currentTime;

    readTemperature();
    readAnalogSensors();
    updateTurbidityAlert();
    updateOLED();
    publishTelemetry();
    Serial.println();
  }
}
