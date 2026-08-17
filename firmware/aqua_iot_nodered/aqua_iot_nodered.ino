/*
 * Aqua IoT - ESP32 firmware
 * Compatible with this project's Node-RED/MQTT backend.
 *
 * Hardware (ESP32 Dev Module, 38 pins):
 *   DS18B20 DAT             -> GPIO13, pull-up 4.7 kOhm to 3.3 V
 *   pH module Po            -> 20 kOhm -> GPIO34 -> 4.7 kOhm -> GND
 *   Turbidity module AO     -> 20 kOhm -> GPIO35 -> 4.7 kOhm -> GND
 *   OLED SDA/SCL            -> GPIO22/GPIO23 (address 0x3C)
 *   Green LED/Red LED       -> GPIO18/GPIO19 through 330 Ohm resistors
 *   Relay IN                -> GPIO26; relay jumper H = active HIGH
 *
 * MQTT topics:
 *   <AQUA_MQTT_TOPIC_ROOT>/data      ESP32 -> Node-RED telemetry JSON
 *   <AQUA_MQTT_TOPIC_ROOT>/status    ESP32 -> Node-RED online/offline retained LWT
 *   <AQUA_MQTT_TOPIC_ROOT>/command   Node-RED -> ESP32 relay/mode JSON command
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <math.h>

// ==================== USER CONFIGURATION ====================

// Keep real network credentials in aqua_secrets.h (ignored by Git).
// Copy aqua_secrets.example.h to aqua_secrets.h before uploading.
#if __has_include("aqua_secrets.h")
#include "aqua_secrets.h"
#else
#define AQUA_WIFI_SSID "AQUA_IOT"
#define AQUA_WIFI_PASSWORD "MAT_KHAU_WIFI_CUA_BAN"
#define AQUA_MQTT_HOST "broker.hivemq.com"
#define AQUA_MQTT_PORT 1883
#define AQUA_MQTT_TOPIC_ROOT "aqua-iot/nhom18-24127175-24127257/esp32-aqua-01"
#define AQUA_MQTT_USERNAME ""
#define AQUA_MQTT_PASSWORD ""
#warning "Using example ESP32 credentials. Create aqua_secrets.h before uploading."
#endif

const char *WIFI_SSID = AQUA_WIFI_SSID;
const char *WIFI_PASSWORD = AQUA_WIFI_PASSWORD;
const char *MQTT_HOST = AQUA_MQTT_HOST;
const uint16_t MQTT_PORT = AQUA_MQTT_PORT;
const char *MQTT_USERNAME = AQUA_MQTT_USERNAME;
const char *MQTT_PASSWORD = AQUA_MQTT_PASSWORD;

const char *DEVICE_ID = "esp32-aqua-01";
const char *FIRMWARE_VERSION = "2.0.0";

// ==================== MQTT CONTRACT ====================

const char *TOPIC_DATA = AQUA_MQTT_TOPIC_ROOT "/data";
const char *TOPIC_STATUS = AQUA_MQTT_TOPIC_ROOT "/status";
const char *TOPIC_COMMAND = AQUA_MQTT_TOPIC_ROOT "/command";

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// ==================== ESP32 PIN MAP ====================

constexpr uint8_t DS18B20_PIN = 13;
constexpr uint8_t PH_PIN = 34;
constexpr uint8_t TURBIDITY_PIN = 35;
constexpr uint8_t LED_GREEN_PIN = 18;
constexpr uint8_t LED_RED_PIN = 19;
constexpr uint8_t RELAY_PIN = 26;
constexpr uint8_t OLED_SDA = 22;
constexpr uint8_t OLED_SCL = 23;

// Relay board in this project uses jumper H: HIGH = ON, LOW = OFF.
constexpr bool RELAY_ACTIVE_HIGH = true;
constexpr bool LED_ACTIVE_HIGH = true;

// ==================== OLED ====================

constexpr uint8_t SCREEN_WIDTH = 128;
constexpr uint8_t SCREEN_HEIGHT = 64;
constexpr int8_t OLED_RESET = -1;
constexpr uint8_t OLED_ADDRESS = 0x3C;

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
bool oledReady = false;

// ==================== SENSOR CONFIGURATION ====================

// Both analog sensors use: module output -> 20 kOhm -> ADC -> 4.7 kOhm -> GND.
constexpr float DIVIDER_R_TOP_OHM = 20000.0f;
constexpr float DIVIDER_R_BOTTOM_OHM = 4700.0f;
constexpr float DIVIDER_FACTOR =
  (DIVIDER_R_TOP_OHM + DIVIDER_R_BOTTOM_OHM) / DIVIDER_R_BOTTOM_OHM;

constexpr uint8_t ANALOG_SAMPLE_COUNT = 32;
constexpr float ANALOG_ADC_SATURATION_V = 3.20f;
constexpr float ANALOG_MODULE_MAX_SAFE_V = 5.50f;

// pH stays null until real buffer calibration is completed.
// When calibration is available, set PH_CALIBRATED=true and enter coefficients
// from pH = PH_SLOPE * moduleVoltage + PH_INTERCEPT.
constexpr bool PH_CALIBRATED = false;
constexpr float PH_SLOPE = 0.0f;
constexpr float PH_INTERCEPT = 0.0f;

// The project currently exposes turbidity RAW/voltage, not an unverified NTU.
constexpr bool TURBIDITY_CALIBRATED = false;

OneWire oneWire(DS18B20_PIN);
DallasTemperature temperatureSensor(&oneWire);

struct AnalogReading {
  float raw;
  float adcVoltage;
  float moduleVoltage;
  bool saturated;
  bool wiringFault;
};

float temperatureC = NAN;
bool temperatureValid = false;
AnalogReading phReading = { 0.0f, 0.0f, 0.0f, false, false };
AnalogReading turbidityReading = { 0.0f, 0.0f, 0.0f, false, false };
float phValue = NAN;

// ==================== LOCAL TURBIDITY ALERT ====================

enum TurbidityThresholdSource {
  TURBIDITY_VALUE_RAW,
  TURBIDITY_VALUE_MODULE_VOLTAGE
};

constexpr TurbidityThresholdSource TURBIDITY_THRESHOLD_SOURCE =
  TURBIDITY_VALUE_MODULE_VOLTAGE;

// Starting threshold only. Calibrate this with actual clear/dirty water samples.
// The tested TS-300B setup produced lower AO voltage when water became dirtier.
constexpr float TURBIDITY_ALERT_THRESHOLD = 2.50f;
constexpr float TURBIDITY_ALERT_HYSTERESIS = 0.05f;
constexpr bool TURBIDITY_ALERT_WHEN_BELOW = true;

bool turbidityAlert = false;
bool alertBlinkOn = false;

// ==================== RELAY STATE ====================

enum RelayControlMode {
  CONTROL_MANUAL,
  CONTROL_AUTO
};

bool relayOn = false;
RelayControlMode relayControlMode = CONTROL_MANUAL;

// AUTO is represented in the protocol and OLED, but deliberately does not
// control the aerator without a dissolved-oxygen sensor/rule validated by the user.
constexpr bool AUTOMATIC_RELAY_RULE_ENABLED = false;

String lastCommandRequestId;
String lastCommandName;
bool telemetryRequested = false;

// ==================== TIMERS ====================

constexpr unsigned long MEASUREMENT_INTERVAL_MS = 3000;
constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 30000;
constexpr unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
constexpr unsigned long ALERT_BLINK_INTERVAL_MS = 350;

unsigned long lastMeasurementAt = 0;
unsigned long lastWiFiAttemptAt = 0;
unsigned long lastMqttAttemptAt = 0;
unsigned long lastAlertBlinkAt = 0;
bool wifiWasConnected = false;
bool wifiAttemptActive = false;
unsigned long wifiAttemptStartedAt = 0;

// ==================== SMALL HELPERS ====================

void writeActiveLevel(uint8_t pin, bool on, bool activeHigh) {
  digitalWrite(pin, on == activeHigh ? HIGH : LOW);
}

bool elapsed(unsigned long now, unsigned long since, unsigned long interval) {
  return static_cast<unsigned long>(now - since) >= interval;
}

const char *modeText() {
  return relayControlMode == CONTROL_AUTO ? "AUTO" : "MANUAL";
}

const char *turbidityMetricText() {
  return TURBIDITY_THRESHOLD_SOURCE == TURBIDITY_VALUE_RAW ? "RAW" : "V";
}

const char *turbidityDirectionText() {
  return TURBIDITY_ALERT_WHEN_BELOW ? "BELOW" : "ABOVE";
}

float turbidityAlertValue() {
  return TURBIDITY_THRESHOLD_SOURCE == TURBIDITY_VALUE_RAW
    ? turbidityReading.raw
    : turbidityReading.moduleVoltage;
}

// Extracts simple string fields produced by this project's backend without
// requiring ArduinoJson. It is intentionally limited to JSON string values.
bool jsonStringValue(const String &json, const char *key, String &result) {
  String marker = "\"" + String(key) + "\"";
  int position = json.indexOf(marker);
  if (position < 0) return false;

  position = json.indexOf(':', position + marker.length());
  if (position < 0) return false;
  position++;
  while (position < static_cast<int>(json.length()) && isspace(json[position])) position++;
  if (position >= static_cast<int>(json.length()) || json[position] != '"') return false;
  position++;

  String value;
  value.reserve(80);
  bool escaped = false;
  for (; position < static_cast<int>(json.length()); position++) {
    const char character = json[position];
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character == '\\') {
      escaped = true;
    } else if (character == '"') {
      result = value;
      return true;
    } else {
      value += character;
    }
  }
  return false;
}

// ==================== RELAY AND LED ====================

void setRelay(bool turnOn, bool printState = true) {
  relayOn = turnOn;
  writeActiveLevel(RELAY_PIN, relayOn, RELAY_ACTIVE_HIGH);
  if (printState) {
    Serial.print("RELAY: ");
    Serial.println(relayOn ? "BAT" : "TAT");
  }
}

void setRelayControlMode(RelayControlMode newMode) {
  relayControlMode = newMode;
  Serial.print("CHE DO: ");
  Serial.println(modeText());

  if (relayControlMode == CONTROL_AUTO && !AUTOMATIC_RELAY_RULE_ENABLED) {
    Serial.println("AUTO chi duoc ghi nhan; relay giu nguyen vi chua co quy tac oxy an toan.");
  }
}

void updateAlertLEDs() {
  const unsigned long now = millis();
  if (!turbidityAlert) {
    writeActiveLevel(LED_GREEN_PIN, true, LED_ACTIVE_HIGH);
    writeActiveLevel(LED_RED_PIN, false, LED_ACTIVE_HIGH);
    alertBlinkOn = false;
    return;
  }

  writeActiveLevel(LED_GREEN_PIN, false, LED_ACTIVE_HIGH);
  if (elapsed(now, lastAlertBlinkAt, ALERT_BLINK_INTERVAL_MS)) {
    lastAlertBlinkAt = now;
    alertBlinkOn = !alertBlinkOn;
  }
  writeActiveLevel(LED_RED_PIN, alertBlinkOn, LED_ACTIVE_HIGH);
}

void evaluateTurbidityAlert() {
  const bool previous = turbidityAlert;
  const float value = turbidityAlertValue();

  if (turbidityReading.wiringFault) {
    turbidityAlert = true;
  } else if (TURBIDITY_ALERT_WHEN_BELOW) {
    turbidityAlert = previous
      ? value < TURBIDITY_ALERT_THRESHOLD + TURBIDITY_ALERT_HYSTERESIS
      : value < TURBIDITY_ALERT_THRESHOLD;
  } else {
    turbidityAlert = previous
      ? value > TURBIDITY_ALERT_THRESHOLD - TURBIDITY_ALERT_HYSTERESIS
      : value > TURBIDITY_ALERT_THRESHOLD;
  }

  if (turbidityAlert != previous) {
    alertBlinkOn = turbidityAlert;
    lastAlertBlinkAt = millis();
    Serial.print("DO DUC: ");
    Serial.print(turbidityAlert ? "CANH BAO" : "BINH THUONG");
    Serial.print(" | ");
    Serial.print(value, TURBIDITY_THRESHOLD_SOURCE == TURBIDITY_VALUE_RAW ? 0 : 3);
    Serial.print(" ");
    Serial.println(turbidityMetricText());
  }
  updateAlertLEDs();
}

// ==================== OLED ====================

void updateOLED() {
  if (!oledReady) return;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  if (turbidityAlert) {
    display.drawRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, SSD1306_WHITE);
    display.setCursor(30, 3);
    display.println("CANH BAO!");
    display.drawLine(1, 13, SCREEN_WIDTH - 2, 13, SSD1306_WHITE);
    display.setCursor(7, 17);
    display.println(turbidityReading.wiringFault ? "LOI DAY DO DUC" : "NUOC QUA DUC");
    display.setCursor(5, 30);
    display.print("Duc: ");
    display.print(turbidityAlertValue(), TURBIDITY_THRESHOLD_SOURCE == TURBIDITY_VALUE_RAW ? 0 : 2);
    display.print(" ");
    display.println(turbidityMetricText());
    display.setCursor(5, 41);
    display.print("Nguong: ");
    display.print(TURBIDITY_ALERT_WHEN_BELOW ? "< " : "> ");
    display.print(TURBIDITY_ALERT_THRESHOLD, TURBIDITY_THRESHOLD_SOURCE == TURBIDITY_VALUE_RAW ? 0 : 2);
    display.setCursor(5, 52);
    display.print("R:");
    display.print(relayOn ? "BAT" : "TAT");
    display.print(" ");
    display.print(modeText());
    display.display();
    return;
  }

  display.setCursor(31, 0);
  display.println("AQUA IOT");
  display.setCursor(0, 12);
  display.print("Nhiet: ");
  if (temperatureValid) {
    display.print(temperatureC, 1);
    display.println(" C");
  } else {
    display.println("LOI");
  }
  display.setCursor(0, 24);
  display.print("Duc AO: ");
  display.print(turbidityReading.moduleVoltage, 2);
  display.println("V");
  display.setCursor(0, 36);
  display.print("pH Po: ");
  display.print(phReading.moduleVoltage, 2);
  display.println("V");
  display.setCursor(0, 48);
  display.print("R:");
  display.print(relayOn ? "BAT" : "TAT");
  display.print(" ");
  display.print(relayControlMode == CONTROL_AUTO ? "A" : "M");
  display.print(" W:");
  display.print(WiFi.status() == WL_CONNECTED ? "1" : "0");
  display.print(" M:");
  display.println(mqttClient.connected() ? "1" : "0");
  display.display();
}

// ==================== SENSOR ACQUISITION ====================

AnalogReading readAnalogFiltered(uint8_t pin) {
  uint32_t rawSum = 0;
  uint32_t millivoltSum = 0;
  uint16_t rawMin = 4095;
  uint16_t rawMax = 0;
  uint32_t millivoltMin = UINT32_MAX;
  uint32_t millivoltMax = 0;

  for (uint8_t index = 0; index < ANALOG_SAMPLE_COUNT; index++) {
    const uint16_t raw = analogRead(pin);
    const uint32_t millivolts = analogReadMilliVolts(pin);
    rawSum += raw;
    millivoltSum += millivolts;
    if (raw < rawMin) rawMin = raw;
    if (raw > rawMax) rawMax = raw;
    if (millivolts < millivoltMin) millivoltMin = millivolts;
    if (millivolts > millivoltMax) millivoltMax = millivolts;
    delay(2);
  }

  const float divisor = static_cast<float>(ANALOG_SAMPLE_COUNT - 2);
  const float rawAverage = (rawSum - rawMin - rawMax) / divisor;
  const float adcVoltage = ((millivoltSum - millivoltMin - millivoltMax) / divisor) / 1000.0f;
  const float moduleVoltage = adcVoltage * DIVIDER_FACTOR;

  AnalogReading reading;
  reading.raw = rawAverage;
  reading.adcVoltage = adcVoltage;
  reading.moduleVoltage = moduleVoltage;
  reading.saturated = rawAverage >= 4085.0f || adcVoltage >= ANALOG_ADC_SATURATION_V;
  reading.wiringFault = reading.saturated || moduleVoltage > ANALOG_MODULE_MAX_SAFE_V;
  return reading;
}

void readAllSensors() {
  temperatureSensor.requestTemperatures();
  const float measuredTemperature = temperatureSensor.getTempCByIndex(0);
  temperatureValid = measuredTemperature != DEVICE_DISCONNECTED_C &&
                     isfinite(measuredTemperature) &&
                     measuredTemperature >= -55.0f && measuredTemperature <= 125.0f;
  temperatureC = temperatureValid ? measuredTemperature : NAN;

  turbidityReading = readAnalogFiltered(TURBIDITY_PIN);
  phReading = readAnalogFiltered(PH_PIN);

  if (PH_CALIBRATED && !phReading.wiringFault) {
    const float calculated = PH_SLOPE * phReading.moduleVoltage + PH_INTERCEPT;
    phValue = calculated >= 0.0f && calculated <= 14.0f ? calculated : NAN;
  } else {
    phValue = NAN;
  }

  evaluateTurbidityAlert();

  Serial.print("Nhiet: ");
  if (temperatureValid) Serial.print(temperatureC, 2); else Serial.print("LOI");
  Serial.print(" C | Duc RAW: ");
  Serial.print(turbidityReading.raw, 0);
  Serial.print(" | AO: ");
  Serial.print(turbidityReading.moduleVoltage, 3);
  Serial.print(" V | pH RAW: ");
  Serial.print(phReading.raw, 0);
  Serial.print(" | Po: ");
  Serial.print(phReading.moduleVoltage, 3);
  Serial.println(" V");

  if (turbidityReading.wiringFault || phReading.wiringFault) {
    Serial.println("CANH BAO: ADC bao hoa/qua ap; rut USB va kiem tra cau chia 20k/4.7k.");
  }
}

// ==================== MQTT TELEMETRY ====================

void appendJsonBoolean(String &payload, bool value) {
  payload += value ? "true" : "false";
}

void publishTelemetry() {
  if (!mqttClient.connected()) return;

  String payload;
  payload.reserve(900);
  payload += "{";
  payload += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  payload += "\"firmwareVersion\":\"" + String(FIRMWARE_VERSION) + "\",";

  payload += "\"temperature\":";
  if (temperatureValid) payload += String(temperatureC, 2); else payload += "null";
  payload += ",\"temperatureValid\":";
  appendJsonBoolean(payload, temperatureValid);

  payload += ",\"turbidityRaw\":" + String(turbidityReading.raw, 0);
  payload += ",\"turbidityAdcVoltage\":" + String(turbidityReading.adcVoltage, 3);
  payload += ",\"turbidityVoltage\":" + String(turbidityReading.moduleVoltage, 3);
  payload += ",\"turbidity\":null";
  payload += ",\"turbidityCalibrated\":";
  appendJsonBoolean(payload, TURBIDITY_CALIBRATED);
  payload += ",\"turbidityAlert\":";
  appendJsonBoolean(payload, turbidityAlert);
  payload += ",\"turbidityThreshold\":" + String(TURBIDITY_ALERT_THRESHOLD, 3);
  payload += ",\"turbidityThresholdMetric\":\"" + String(turbidityMetricText()) + "\"";
  payload += ",\"turbidityThresholdDirection\":\"" + String(turbidityDirectionText()) + "\"";
  payload += ",\"turbidityWiringFault\":";
  appendJsonBoolean(payload, turbidityReading.wiringFault);

  payload += ",\"phRaw\":" + String(phReading.raw, 0);
  payload += ",\"phAdcVoltage\":" + String(phReading.adcVoltage, 3);
  payload += ",\"phVoltage\":" + String(phReading.moduleVoltage, 3);
  payload += ",\"ph\":";
  if (PH_CALIBRATED && isfinite(phValue)) payload += String(phValue, 2); else payload += "null";
  payload += ",\"phCalibrated\":";
  appendJsonBoolean(payload, PH_CALIBRATED && isfinite(phValue));
  payload += ",\"phWiringFault\":";
  appendJsonBoolean(payload, phReading.wiringFault);

  payload += ",\"relayStatus\":\"" + String(relayOn ? "ON" : "OFF") + "\"";
  payload += ",\"controlMode\":\"" + String(modeText()) + "\"";
  payload += ",\"automaticControlActive\":";
  appendJsonBoolean(payload, relayControlMode == CONTROL_AUTO && AUTOMATIC_RELAY_RULE_ENABLED);
  payload += ",\"rssi\":" + String(WiFi.RSSI());
  payload += ",\"uptimeMs\":" + String(millis());

  if (lastCommandRequestId.length() > 0) {
    payload += ",\"lastCommandRequestId\":\"" + lastCommandRequestId + "\"";
    payload += ",\"lastCommand\":\"" + lastCommandName + "\"";
  }
  payload += "}";

  const bool published = mqttClient.publish(TOPIC_DATA, payload.c_str(), false);
  Serial.print(published ? "MQTT TX: " : "MQTT TX LOI: ");
  Serial.println(payload);
}

// ==================== MQTT COMMANDS ====================

void requestTelemetryNow() {
  // Publishing outside the PubSubClient callback is safer and lets loop()
  // acknowledge the command immediately after callback processing completes.
  telemetryRequested = true;
}

void applyPlainOrJsonCommand(const String &incoming) {
  String raw = incoming;
  raw.trim();
  if (raw.length() == 0) return;

  String command;
  String requestedMode;
  String targetDevice;
  String requestId;
  const bool isJson = raw[0] == '{';

  if (isJson) {
    jsonStringValue(raw, "command", command);
    jsonStringValue(raw, "mode", requestedMode);
    jsonStringValue(raw, "deviceId", targetDevice);
    jsonStringValue(raw, "requestId", requestId);
  } else {
    command = raw;
  }

  command.trim();
  requestedMode.trim();
  command.toUpperCase();
  requestedMode.toUpperCase();

  if (targetDevice.length() > 0 && targetDevice != DEVICE_ID && targetDevice != "*") {
    Serial.print("Bo qua lenh cho thiet bi khac: ");
    Serial.println(targetDevice);
    return;
  }

  bool handled = false;
  if (command == "MODE" || command == "AUTO" || command == "MANUAL") {
    const String mode = command == "MODE" ? requestedMode : command;
    if (mode == "AUTO") {
      setRelayControlMode(CONTROL_AUTO);
      handled = true;
    } else if (mode == "MANUAL") {
      setRelayControlMode(CONTROL_MANUAL);
      handled = true;
    }
  } else if (command == "ON" || command == "1") {
    // Direct ON/OFF from the website is always a manual override.
    setRelayControlMode(CONTROL_MANUAL);
    setRelay(true);
    handled = true;
  } else if (command == "OFF" || command == "0") {
    setRelayControlMode(CONTROL_MANUAL);
    setRelay(false);
    handled = true;
  }

  if (!handled) {
    Serial.print("Lenh MQTT khong hop le: ");
    Serial.println(command);
    return;
  }

  lastCommandName = command;
  lastCommandRequestId = requestId;
  updateOLED();
  requestTelemetryNow();
}

void mqttCallback(char *topic, byte *payload, unsigned int length) {
  if (strcmp(topic, TOPIC_COMMAND) != 0) return;
  if (length == 0 || length > 768) {
    Serial.println("Bo qua lenh MQTT rong/qua dai.");
    return;
  }

  String incoming;
  incoming.reserve(length + 1);
  for (unsigned int index = 0; index < length; index++) incoming += static_cast<char>(payload[index]);

  Serial.print("MQTT RX [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(incoming);
  applyPlainOrJsonCommand(incoming);
}

// ==================== NETWORK CONNECTION ====================

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiAttemptActive = false;
    return;
  }

  const unsigned long now = millis();

  // WiFi.begin() is asynchronous. Calling it again while the station is still
  // connecting causes: "sta is connecting, cannot set config". Wait for the
  // current attempt to finish or time out before resetting the station.
  if (wifiAttemptActive) {
    if (!elapsed(now, wifiAttemptStartedAt, WIFI_CONNECT_TIMEOUT_MS)) return;

    Serial.print("WiFi timeout sau 30 giay, status = ");
    Serial.println(static_cast<int>(WiFi.status()));
    WiFi.disconnect(false, false);
    wifiAttemptActive = false;
    lastWiFiAttemptAt = now;
    return;
  }

  if (lastWiFiAttemptAt != 0 && !elapsed(now, lastWiFiAttemptAt, WIFI_RETRY_INTERVAL_MS)) return;
  lastWiFiAttemptAt = now;
  wifiAttemptStartedAt = now;
  wifiAttemptActive = true;

  Serial.print("Dang ket noi WiFi: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected()) return;
  const unsigned long now = millis();
  if (lastMqttAttemptAt != 0 && !elapsed(now, lastMqttAttemptAt, MQTT_RETRY_INTERVAL_MS)) return;
  lastMqttAttemptAt = now;

  String clientId = String(DEVICE_ID) + "-" +
                    String(static_cast<uint32_t>(ESP.getEfuseMac() & 0xFFFFFFFF), HEX);
  Serial.print("Dang ket noi MQTT ");
  Serial.print(MQTT_HOST);
  Serial.print(":");
  Serial.println(MQTT_PORT);

  bool connected;
  if (strlen(MQTT_USERNAME) > 0) {
    connected = mqttClient.connect(
      clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD,
      TOPIC_STATUS, 1, true, "offline"
    );
  } else {
    connected = mqttClient.connect(clientId.c_str(), TOPIC_STATUS, 1, true, "offline");
  }

  if (connected) {
    Serial.println("MQTT: DA KET NOI");
    mqttClient.publish(TOPIC_STATUS, "online", true);
    mqttClient.subscribe(TOPIC_COMMAND, 1);
    requestTelemetryNow();
  } else {
    Serial.print("MQTT loi, state = ");
    Serial.println(mqttClient.state());
  }
}

// ==================== SERIAL FALLBACK ====================

void handleSerialCommand() {
  while (Serial.available() > 0) {
    const char input = Serial.read();
    if (input == '1') applyPlainOrJsonCommand("ON");
    else if (input == '0') applyPlainOrJsonCommand("OFF");
    else if (input == 'A' || input == 'a') applyPlainOrJsonCommand("AUTO");
    else if (input == 'M' || input == 'm') applyPlainOrJsonCommand("MANUAL");
  }
}

// ==================== SETUP AND LOOP ====================

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.print("Aqua IoT firmware ");
  Serial.println(FIRMWARE_VERSION);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  setRelay(false);
  updateAlertLEDs();

  temperatureSensor.begin();
  temperatureSensor.setResolution(11);

  analogReadResolution(12);
  analogSetPinAttenuation(PH_PIN, ADC_11db);
  analogSetPinAttenuation(TURBIDITY_PIN, ADC_11db);

  Wire.begin(OLED_SDA, OLED_SCL);
  oledReady = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
  if (!oledReady) Serial.println("OLED 0x3C khong tim thay; he thong van tiep tuc chay.");

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);
  mqttClient.setKeepAlive(30);
  mqttClient.setSocketTimeout(5);

  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  connectWiFi();

  // First measurement is available even before Wi-Fi/MQTT connects.
  readAllSensors();
  updateOLED();
  lastMeasurementAt = millis();
}

void loop() {
  const unsigned long now = millis();

  handleSerialCommand();
  updateAlertLEDs();

  const bool wifiConnected = WiFi.status() == WL_CONNECTED;
  if (wifiConnected && !wifiWasConnected) {
    wifiAttemptActive = false;
    Serial.print("WiFi OK, IP ESP32: ");
    Serial.println(WiFi.localIP());
    lastMqttAttemptAt = 0;
  } else if (!wifiConnected && wifiWasConnected) {
    Serial.println("WiFi da mat; cam bien va canh bao cuc bo van hoat dong.");
    // setAutoReconnect() starts a background reconnect. Mark that attempt as
    // active so connectWiFi() does not call WiFi.begin() on top of it.
    wifiAttemptActive = true;
    wifiAttemptStartedAt = now;
    lastWiFiAttemptAt = now;
  }
  wifiWasConnected = wifiConnected;

  if (!wifiConnected) connectWiFi();

  connectMQTT();
  mqttClient.loop();

  if (telemetryRequested) {
    telemetryRequested = false;
    publishTelemetry();
    updateOLED();
  }

  if (elapsed(now, lastMeasurementAt, MEASUREMENT_INTERVAL_MS)) {
    lastMeasurementAt = now;
    readAllSensors();
    publishTelemetry();
    updateOLED();
  }
}
