#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ==================== WIFI VA MQTT ====================

const char *WIFI_SSID = "TEN_WIFI_CUA_BAN";
const char *WIFI_PASSWORD = "MAT_KHAU_WIFI_CUA_BAN";

// Public broker: khong can chay Mosquitto tren may tinh.
const char *MQTT_HOST = "broker.hivemq.com";
const uint16_t MQTT_PORT = 1883;

// Device ID duoc dat rieng de tranh trung topic tren public broker.
const char *DEVICE_ID = "hcmus-aqua-18";
const char *TOPIC_DATA = "aquaiot/hcmus-aqua-18/telemetry";
const char *TOPIC_STATUS = "aquaiot/hcmus-aqua-18/status";
const char *TOPIC_COMMAND = "aquaiot/hcmus-aqua-18/command";

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// ==================== CHAN ESP32 ====================

#define DS18B20_PIN   13
#define PH_PIN        34
#define TURBIDITY_PIN 35

#define LED_GREEN_PIN 18
#define LED_RED_PIN   19
#define RELAY_PIN     26

#define OLED_SDA      22
#define OLED_SCL      23

// ==================== OLED ====================

#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define OLED_ADDRESS  0x3C

Adafruit_SSD1306 display(
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  &Wire,
  OLED_RESET
);

bool oledReady = false;

// ==================== CAM BIEN ====================

#define SAMPLE_COUNT 50

// pH va do duc deu dung cau chia: 20k phia module, 4.7k phia GND.
const float DIVIDER_FACTOR = 5.2553f;

OneWire oneWire(DS18B20_PIN);
DallasTemperature temperatureSensor(&oneWire);

float temperatureC = DEVICE_DISCONNECTED_C;
float turbidityRaw = 0.0f;
float turbidityADC = 0.0f;
float turbidityVoltage = 0.0f;
float phRaw = 0.0f;
float phADC = 0.0f;
float phVoltage = 0.0f;
float phValue = NAN;

// Hieu chuan 2 diem: thay hai dien ap nay bang so do cua chinh dau do.
// Cach lam: ngam vao dung dich pH 4 va pH 7, doc phVoltage tren Serial.
const float PH4_VOLTAGE = 3.00f;
const float PH7_VOLTAGE = 2.50f;
const bool PH_CALIBRATED = true;

// ==================== CANH BAO DO DUC CUC BO ====================

// Doi sang TURBIDITY_VALUE_RAW neu muon dat nguong theo ADC RAW.
// Mac dinh dung dien ap tai chan AO cua module (da quy doi qua cau chia ap).
enum TurbidityThresholdSource {
  TURBIDITY_VALUE_RAW,
  TURBIDITY_VALUE_MODULE_VOLTAGE
};

const TurbidityThresholdSource TURBIDITY_THRESHOLD_SOURCE =
  TURBIDITY_VALUE_MODULE_VOLTAGE;

// TS-300B thong thuong cho dien ap giam khi nuoc duc hon. Gia tri 2.50 V
// chi la nguong khoi dau; can hieu chuan bang mau nuoc thuc te sau.
const float TURBIDITY_ALERT_THRESHOLD = 2.50f;
const bool TURBIDITY_ALERT_WHEN_BELOW = true;

bool turbidityAlert = false;
bool alertBlinkOn = false;

enum RelayControlMode {
  CONTROL_MANUAL,
  CONTROL_AUTO
};

bool relayOn = false;
RelayControlMode relayControlMode = CONTROL_MANUAL;

unsigned long lastMeasurement = 0;
unsigned long lastMqttAttempt = 0;
unsigned long lastWiFiAttempt = 0;
unsigned long lastAlertBlink = 0;
bool wifiWasConnected = false;

const unsigned long MEASUREMENT_INTERVAL = 3000;
const unsigned long MQTT_RETRY_INTERVAL = 5000;
const unsigned long WIFI_RETRY_INTERVAL = 10000;
const unsigned long ALERT_BLINK_INTERVAL = 350;

float calculatePH(float voltage) {
  if (!PH_CALIBRATED || fabs(PH4_VOLTAGE - PH7_VOLTAGE) < 0.01f) {
    return NAN;
  }

  const float slope = (7.0f - 4.0f) / (PH7_VOLTAGE - PH4_VOLTAGE);
  const float value = 4.0f + (voltage - PH4_VOLTAGE) * slope;
  return constrain(value, 0.0f, 14.0f);
}

// ==================== RELAY, CHE DO VA LED ====================

void setRelay(bool turnOn) {
  relayOn = turnOn;

  // Jumper relay dang o H: HIGH = BAT, LOW = TAT.
  digitalWrite(RELAY_PIN, relayOn ? HIGH : LOW);

  Serial.print("RELAY: ");
  Serial.println(relayOn ? "BAT" : "TAT");
}

const char *relayModeText() {
  return relayControlMode == CONTROL_AUTO ? "AUTO" : "MANUAL";
}

void setRelayControlMode(RelayControlMode newMode) {
  relayControlMode = newMode;

  // AUTO hien tai chi la trang thai che do. Chua co quy tac dieu khien du
  // an toan, vi vay doi che do KHONG duoc tu dong bat/tat relay.
  Serial.print("CHE DO RELAY: ");
  Serial.print(relayModeText());
  Serial.println(" (khong tu dong doi relay)");
}

float turbidityAlertValue() {
  return TURBIDITY_THRESHOLD_SOURCE == TURBIDITY_VALUE_RAW
    ? turbidityRaw
    : turbidityVoltage;
}

const char *turbidityMetricText() {
  return TURBIDITY_THRESHOLD_SOURCE == TURBIDITY_VALUE_RAW
    ? "RAW"
    : "V";
}

void updateTurbidityLEDs() {
  if (!turbidityAlert) {
    // Theo YC1: xanh = do duc binh thuong, do = canh bao.
    digitalWrite(LED_GREEN_PIN, HIGH);
    digitalWrite(LED_RED_PIN, LOW);
    alertBlinkOn = false;
    return;
  }

  digitalWrite(LED_GREEN_PIN, LOW);

  if (millis() - lastAlertBlink >= ALERT_BLINK_INTERVAL) {
    lastAlertBlink = millis();
    alertBlinkOn = !alertBlinkOn;
  }

  digitalWrite(LED_RED_PIN, alertBlinkOn ? HIGH : LOW);
}

void evaluateTurbidityAlert() {
  const bool previousAlert = turbidityAlert;
  const float value = turbidityAlertValue();

  turbidityAlert = TURBIDITY_ALERT_WHEN_BELOW
    ? value < TURBIDITY_ALERT_THRESHOLD
    : value > TURBIDITY_ALERT_THRESHOLD;

  if (turbidityAlert != previousAlert) {
    alertBlinkOn = turbidityAlert;
    lastAlertBlink = millis();

    Serial.print("DO DUC: ");
    Serial.print(turbidityAlert ? "CANH BAO" : "BINH THUONG");
    Serial.print(" | Gia tri: ");
    Serial.print(
      value,
      TURBIDITY_THRESHOLD_SOURCE == TURBIDITY_VALUE_RAW ? 0 : 3
    );
    Serial.print(" ");
    Serial.print(turbidityMetricText());
    Serial.print(" | Nguong: ");
    Serial.println(
      TURBIDITY_ALERT_THRESHOLD,
      TURBIDITY_THRESHOLD_SOURCE == TURBIDITY_VALUE_RAW ? 0 : 3
    );
  }

  updateTurbidityLEDs();
}

// ==================== OLED ====================

void updateOLED() {
  if (!oledReady) {
    return;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  if (turbidityAlert) {
    display.drawRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, SSD1306_WHITE);
    display.setCursor(30, 3);
    display.println("CANH BAO!");
    display.drawLine(1, 13, SCREEN_WIDTH - 2, 13, SSD1306_WHITE);

    display.setCursor(7, 17);
    display.println("NUOC QUA DUC");

    display.setCursor(5, 30);
    display.print("Do duc: ");
    display.print(
      turbidityAlertValue(),
      TURBIDITY_THRESHOLD_SOURCE == TURBIDITY_VALUE_RAW ? 0 : 2
    );
    display.print(" ");
    display.println(turbidityMetricText());

    display.setCursor(5, 41);
    display.print("Nguong: ");
    display.print(TURBIDITY_ALERT_WHEN_BELOW ? "< " : "> ");
    display.print(
      TURBIDITY_ALERT_THRESHOLD,
      TURBIDITY_THRESHOLD_SOURCE == TURBIDITY_VALUE_RAW ? 0 : 2
    );
    display.print(" ");
    display.println(turbidityMetricText());

    display.setCursor(5, 52);
    display.print("Relay:");
    display.print(relayOn ? "BAT" : "TAT");
    display.print(" ");
    display.println(relayModeText());

    display.display();
    return;
  }

  display.setCursor(31, 0);
  display.println("AQUA IOT");

  display.setCursor(0, 12);
  display.print("Nhiet: ");
  if (temperatureC == DEVICE_DISCONNECTED_C) {
    display.println("LOI");
  } else {
    display.print(temperatureC, 1);
    display.println(" C");
  }

  display.setCursor(0, 24);
  display.print("Duc AO: ");
  display.print(turbidityVoltage, 2);
  display.println(" V");

  display.setCursor(0, 36);
  display.print("pH: ");
  if (isnan(phValue)) {
    display.println("CHUA HC");
  } else {
    display.println(phValue, 2);
  }

  display.setCursor(0, 48);
  display.print("R:");
  display.print(relayOn ? "BAT" : "TAT");
  display.print(" ");
  display.print(relayControlMode == CONTROL_AUTO ? "A" : "M");
  display.print(" MQTT:");
  display.println(mqttClient.connected() ? "OK" : "--");

  display.display();
}

// ==================== ADC ====================

void readAnalogAverage(
  int pin,
  float &rawAverage,
  float &voltageADC
) {
  uint32_t rawSum = 0;
  uint32_t milliVoltSum = 0;

  for (int i = 0; i < SAMPLE_COUNT; i++) {
    rawSum += analogRead(pin);
    milliVoltSum += analogReadMilliVolts(pin);
    delay(3);
  }

  rawAverage = rawSum / (float)SAMPLE_COUNT;
  voltageADC =
    (milliVoltSum / (float)SAMPLE_COUNT) / 1000.0f;
}

void readAllSensors() {
  temperatureSensor.requestTemperatures();
  temperatureC = temperatureSensor.getTempCByIndex(0);

  readAnalogAverage(
    TURBIDITY_PIN,
    turbidityRaw,
    turbidityADC
  );
  turbidityVoltage = turbidityADC * DIVIDER_FACTOR;

  readAnalogAverage(PH_PIN, phRaw, phADC);
  phVoltage = phADC * DIVIDER_FACTOR;
  phValue = calculatePH(phVoltage);

  evaluateTurbidityAlert();
}

// ==================== MQTT ====================

void mqttCallback(char *topic, byte *payload, unsigned int length) {
  String command;
  command.reserve(length + 1);

  for (unsigned int i = 0; i < length; i++) {
    command += (char)payload[i];
  }

  command.trim();
  command.toUpperCase();
  command.replace(" ", "");
  command.replace("\t", "");
  command.replace("\r", "");
  command.replace("\n", "");

  Serial.print("MQTT RX [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(command);

  const bool requestsModeOnly =
    command == "AUTO" ||
    command == "MANUAL" ||
    command.indexOf("\"COMMAND\":\"MODE\"") >= 0;

  if (
    command == "AUTO" ||
    command.indexOf("\"MODE\":\"AUTO\"") >= 0
  ) {
    setRelayControlMode(CONTROL_AUTO);
  } else if (
    command == "MANUAL" ||
    command.indexOf("\"MODE\":\"MANUAL\"") >= 0
  ) {
    setRelayControlMode(CONTROL_MANUAL);
  }

  if (
    command == "1" ||
    command == "ON" ||
    command.indexOf("\"COMMAND\":\"ON\"") >= 0
  ) {
    // ON/OFF la lenh ghi de thu cong, nen chuyen ve MANUAL.
    setRelayControlMode(CONTROL_MANUAL);
    setRelay(true);
  } else if (
    command == "0" ||
    command == "OFF" ||
    command.indexOf("\"COMMAND\":\"OFF\"") >= 0
  ) {
    setRelayControlMode(CONTROL_MANUAL);
    setRelay(false);
  } else if (requestsModeOnly) {
    Serial.println("Da doi che do; relay giu nguyen trang thai");
  }

  updateOLED();
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (
    lastWiFiAttempt != 0 &&
    millis() - lastWiFiAttempt < WIFI_RETRY_INTERVAL
  ) {
    return;
  }

  lastWiFiAttempt = millis();

  Serial.print("Dang ket noi WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void connectMQTT() {
  if (
    WiFi.status() != WL_CONNECTED ||
    mqttClient.connected()
  ) {
    return;
  }

  if (millis() - lastMqttAttempt < MQTT_RETRY_INTERVAL) {
    return;
  }

  lastMqttAttempt = millis();

  String clientId = String(DEVICE_ID) + "-" +
                    String((uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFF), HEX);

  Serial.print("Dang ket noi MQTT ");
  Serial.print(MQTT_HOST);
  Serial.print(":");
  Serial.println(MQTT_PORT);

  bool connected = mqttClient.connect(
    clientId.c_str(),
    TOPIC_STATUS,
    1,
    true,
    "offline"
  );

  if (connected) {
    Serial.println("MQTT: DA KET NOI");
    mqttClient.publish(TOPIC_STATUS, "online", true);
    mqttClient.subscribe(TOPIC_COMMAND, 1);
  } else {
    Serial.print("MQTT loi, state = ");
    Serial.println(mqttClient.state());
  }
}

void publishTelemetry() {
  if (!mqttClient.connected()) {
    return;
  }

  String payload = "{";
  payload += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";

  if (temperatureC == DEVICE_DISCONNECTED_C) {
    payload += "\"temperature\":null,";
  } else {
    payload += "\"temperature\":" + String(temperatureC, 2) + ",";
  }

  payload += "\"turbidityRaw\":" + String(turbidityRaw, 0) + ",";
  payload += "\"turbidityVoltage\":" + String(turbidityVoltage, 3) + ",";
  payload += "\"turbidityAlert\":" + String(turbidityAlert ? "true" : "false") + ",";
  payload += "\"phRaw\":" + String(phRaw, 0) + ",";
  payload += "\"phVoltage\":" + String(phVoltage, 3) + ",";
  if (isnan(phValue)) {
    payload += "\"ph\":null,";
  } else {
    payload += "\"ph\":" + String(phValue, 2) + ",";
  }
  payload += "\"phCalibrated\":" + String(!isnan(phValue) ? "true" : "false") + ",";
  payload += "\"relayStatus\":\"" + String(relayOn ? "ON" : "OFF") + "\",";
  payload += "\"controlMode\":\"" + String(relayModeText()) + "\",";
  payload += "\"rssi\":" + String(WiFi.RSSI());
  payload += "}";

  bool ok = mqttClient.publish(TOPIC_DATA, payload.c_str(), false);

  Serial.print(ok ? "MQTT TX: " : "MQTT TX LOI: ");
  Serial.println(payload);
}

// ==================== SERIAL DU PHONG ====================

void handleSerialCommand() {
  while (Serial.available() > 0) {
    char command = Serial.read();

    if (command == '1') {
      setRelayControlMode(CONTROL_MANUAL);
      setRelay(true);
      updateOLED();
    } else if (command == '0') {
      setRelayControlMode(CONTROL_MANUAL);
      setRelay(false);
      updateOLED();
    } else if (command == 'A' || command == 'a') {
      setRelayControlMode(CONTROL_AUTO);
      updateOLED();
    } else if (command == 'M' || command == 'm') {
      setRelayControlMode(CONTROL_MANUAL);
      updateOLED();
    }
  }
}

// ==================== SETUP VA LOOP ====================

void setup() {
  Serial.begin(115200);
  delay(500);

  digitalWrite(RELAY_PIN, LOW);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  setRelay(false);
  updateTurbidityLEDs();

  temperatureSensor.begin();

  analogReadResolution(12);
  analogSetPinAttenuation(PH_PIN, ADC_11db);
  analogSetPinAttenuation(TURBIDITY_PIN, ADC_11db);

  Wire.begin(OLED_SDA, OLED_SCL);
  oledReady = display.begin(
    SSD1306_SWITCHCAPVCC,
    OLED_ADDRESS
  );

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);

  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  connectWiFi();

  lastMqttAttempt = millis() - MQTT_RETRY_INTERVAL;
  lastMeasurement = millis() - MEASUREMENT_INTERVAL;

  updateOLED();
}

void loop() {
  handleSerialCommand();
  updateTurbidityLEDs();

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  bool wifiConnected = WiFi.status() == WL_CONNECTED;

  if (wifiConnected && !wifiWasConnected) {
    Serial.print("WiFi OK, IP ESP32: ");
    Serial.println(WiFi.localIP());
  } else if (!wifiConnected && wifiWasConnected) {
    Serial.println("WiFi da mat ket noi; cam bien van tiep tuc chay");
  }

  wifiWasConnected = wifiConnected;

  connectMQTT();
  mqttClient.loop();

  if (millis() - lastMeasurement >= MEASUREMENT_INTERVAL) {
    lastMeasurement = millis();

    readAllSensors();
    publishTelemetry();
    updateOLED();
  }
}
