#include <WiFi.h>
#include <WiFiClientSecure.h>
#define MQTT_MAX_PACKET_SIZE 1024
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SPI.h>
#include <MFRC522.h>

// ================= WIFI =================
const char* ssid = "YOUR_WIFI_NAME";
const char* password = "YOUR_WIFI_PASSWORD";

// ================= MQTT =================
const char* mqtt_server = "18ae47c8570f47e183ae798b2758364f.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_user = "smartSOS";
const char* mqtt_pass = "Password123";

const char* topic_parking = "parking/update";
const char* topic_alert = "sos/alert";
const char* topic_rfid_scan = "rfid/scan";
const char* topic_rfid_result = "rfid/scan/result/esp32_parking_rfid";
const char* device_id = "esp32_parking_rfid";

// ================= PINS =================
#define VIS_R1 14
#define VIS_R2 27
#define VIS_SERVO_PIN 18

#define RES_R3 26
#define RES_R4 25
#define RES_SERVO_PIN 19

#define SOS_BUTTON_PIN 13
#define BUZZER_PIN 23

// ================= LCD PINS =================
#define PARKING_LCD_SDA 21
#define PARKING_LCD_SCL 22

#define RFID_LCD_SDA 16
#define RFID_LCD_SCL 17

// ================= RFID PINS =================
#define RFID_SS_PIN 5
#define RFID_RST_PIN 4
#define RFID_SCK_PIN 32
#define RFID_MOSI_PIN 33
#define RFID_MISO_PIN 35

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);
MFRC522::MIFARE_Key mifareKey;

LiquidCrystal_I2C parkingLCD(0x27, 20, 4);
LiquidCrystal_I2C rfidLCD(0x27, 20, 4);

// ================= SERVO =================
Servo visitorServo;
Servo residentServo;

const int GATE_OPEN_ANGLE = 90;
const int GATE_CLOSE_ANGLE = 180;
const unsigned long GATE_CLOSE_DELAY = 1500;

// ================= CLIENT =================
WiFiClientSecure espClient;
PubSubClient client(espClient);

// ================= STATE =================
bool sosSent = false;
bool visitorProcessing = false;
bool residentProcessing = false;

int visitorState = 0;
int residentState = 0;

unsigned long visitorStartTime = 0;
unsigned long residentStartTime = 0;
unsigned long lastVisitorEvent = 0;
unsigned long lastResidentEvent = 0;

const unsigned long SENSOR_TIMEOUT = 5000;
const unsigned long EVENT_COOLDOWN = 1500;
const unsigned long WIFI_CONNECT_TIMEOUT = 15000;
const unsigned long MQTT_RETRY_INTERVAL = 5000;
const unsigned long RFID_DEBUG_INTERVAL = 2000;
const unsigned long RFID_LCD_RESULT_DISPLAY_MS = 5000;
const unsigned long RFID_LCD_WAIT_RESULT_TIMEOUT_MS = 10000;

const byte MIFARE_COMMON_KEYS[][6] = {
  {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF},
  {0xD3, 0xF7, 0xD3, 0xF7, 0xD3, 0xF7},
  {0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5},
  {0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5},
  {0x00, 0x00, 0x00, 0x00, 0x00, 0x00},
  {0x4D, 0x3A, 0x99, 0xC3, 0x51, 0xDD},
  {0x1A, 0x98, 0x2C, 0x7E, 0x45, 0x9A},
};
const byte MIFARE_COMMON_KEY_COUNT =
  sizeof(MIFARE_COMMON_KEYS) / sizeof(MIFARE_COMMON_KEYS[0]);

String lastCardCode = "";
unsigned long lastRFIDScanTime = 0;
unsigned long lastMQTTRetry = 0;
unsigned long lastRFIDDebugPrint = 0;
unsigned long rfidLcdResetAt = 0;
const unsigned long RFID_COOLDOWN = 3000;

// ================= LCD BUS SELECT =================
void selectParkingLCD() {
  Wire.end();
  Wire.begin(PARKING_LCD_SDA, PARKING_LCD_SCL);
}

void selectRFIDLCD() {
  Wire.end();
  Wire.begin(RFID_LCD_SDA, RFID_LCD_SCL);
}

// ================= PARKING LCD =================
void showParkingLCD(String line1, String line2 = "", String line3 = "", String line4 = "") {
  selectParkingLCD();
  parkingLCD.clear();
  parkingLCD.setCursor(0, 0); parkingLCD.print(line1);
  parkingLCD.setCursor(0, 1); parkingLCD.print(line2);
  parkingLCD.setCursor(0, 2); parkingLCD.print(line3);
  parkingLCD.setCursor(0, 3); parkingLCD.print(line4);
}

void showDefaultParkingLCD() {
  showParkingLCD("Car Parking", "System Ready", "Visitor & Resident", "Smart City");
}

// ================= RFID LCD =================
void showRFIDLCD(String line1, String line2 = "", String line3 = "", String line4 = "") {
  selectRFIDLCD();
  rfidLCD.clear();
  rfidLCD.setCursor(0, 0); rfidLCD.print(line1);
  rfidLCD.setCursor(0, 1); rfidLCD.print(line2);
  rfidLCD.setCursor(0, 2); rfidLCD.print(line3);
  rfidLCD.setCursor(0, 3); rfidLCD.print(line4);
}

void showDefaultRFIDLCD() {
  rfidLcdResetAt = 0;
  showRFIDLCD("RFID Scanner", "Scan Resident Card", "Content: RES-...", "Waiting...");
}

void scheduleRFIDLCDReset() {
  rfidLcdResetAt = millis() + RFID_LCD_RESULT_DISPLAY_MS;
}

void scheduleRFIDLCDReset(unsigned long delayMs) {
  rfidLcdResetAt = millis() + delayMs;
}

void handleRFIDLCDReset() {
  if (rfidLcdResetAt > 0 && millis() >= rfidLcdResetAt) {
    showDefaultRFIDLCD();
  }
}

// ================= GATE =================
void closeVisitorGate() {
  delay(GATE_CLOSE_DELAY);
  visitorServo.write(GATE_CLOSE_ANGLE);
}

void closeResidentGate() {
  delay(GATE_CLOSE_DELAY);
  residentServo.write(GATE_CLOSE_ANGLE);
}

// ================= WIFI =================
void setupWiFi() {
  Serial.print("Connecting WiFi");
  WiFi.begin(ssid, password);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi Connected");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Gateway: ");
    Serial.println(WiFi.gatewayIP());
    Serial.print("Subnet: ");
    Serial.println(WiFi.subnetMask());
    Serial.print("RSSI: ");
    Serial.println(WiFi.RSSI());
    Serial.print("RFID MQTT topic: ");
    Serial.println(topic_rfid_scan);
    Serial.print("RFID result topic: ");
    Serial.println(topic_rfid_result);
  } else {
    Serial.println("WiFi connection timeout. RFID local scan will still run.");
  }
}

// ================= MQTT =================
void reconnectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (client.connected()) return;
  if (lastMQTTRetry > 0 && millis() - lastMQTTRetry < MQTT_RETRY_INTERVAL) return;

  lastMQTTRetry = millis();
  Serial.print("Connecting MQTT... ");

  String clientId = "esp32_parking_" + String(random(0xffff), HEX);

  if (client.connect(clientId.c_str(), mqtt_user, mqtt_pass)) {
    Serial.println("Connected");
    bool subscribed = client.subscribe(topic_rfid_result);
    Serial.print("Subscribe RFID result ");
    Serial.print(subscribed ? "OK: " : "FAILED: ");
    Serial.println(topic_rfid_result);
  } else {
    Serial.print("Failed, rc=");
    Serial.println(client.state());
  }
}

// ================= SENSOR =================
bool detected(int pin) {
  if (digitalRead(pin) == LOW) {
    delay(60);
    return digitalRead(pin) == LOW;
  }
  return false;
}

void waitRelease(int pin) {
  unsigned long start = millis();
  while (digitalRead(pin) == LOW) {
    delay(10);
    if (millis() - start > 3000) break;
  }
}

void waitBothRelease(int pin1, int pin2) {
  unsigned long start = millis();
  while (digitalRead(pin1) == LOW || digitalRead(pin2) == LOW) {
    delay(10);
    if (millis() - start > 3000) break;
  }
}

// ================= MQTT PUBLISH =================
void publishParkingDelta(const char* type, int delta) {
  StaticJsonDocument<128> doc;
  doc["type"] = type;
  doc["delta"] = delta;
  doc["source"] = "ESP32";
  doc["device_id"] = device_id;

  char buffer[128];
  serializeJson(doc, buffer);

  bool ok = client.publish(topic_parking, buffer);

  Serial.print("Parking MQTT Send: ");
  Serial.println(buffer);

  if (ok) Serial.println("Parking published");
  else Serial.println("Parking publish failed");
}

void publishSOS() {
  StaticJsonDocument<128> doc;
  doc["status"] = "SOS_ACTIVE";
  doc["source"] = "ESP32";
  doc["device_id"] = device_id;
  doc["message"] = "Emergency button pressed";

  char buffer[128];
  serializeJson(doc, buffer);

  client.publish(topic_alert, buffer);

  Serial.print("SOS MQTT Send: ");
  Serial.println(buffer);
}

void handleMqttMessage(char* topic, byte* payload, unsigned int length) {
  Serial.print("MQTT message topic: ");
  Serial.println(topic);

  if (String(topic) != topic_rfid_result) return;

  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, payload, length);

  if (error) {
    Serial.print("RFID result JSON parse error: ");
    Serial.println(error.c_str());
    showRFIDLCD("RFID Result Error", "Invalid MQTT JSON", "", "");
    scheduleRFIDLCDReset();
    return;
  }

  bool valid = doc["valid"] | false;
  const char* message = doc["message"] | "RFID result";
  const char* hardwareUid = doc["hardwareUid"] | "";

  Serial.print("RFID MQTT Result: ");
  serializeJson(doc, Serial);
  Serial.println();

  if (valid) {
    const char* personType = doc["personType"] | "resident";
    const char* compactName = doc["name"] | "";
    const char* residentName = doc["resident"]["fullname"] | "";
    const char* visitorName = doc["visitor"]["fullname"] | "";
    const char* displayName = strlen(residentName) > 0 ? residentName : visitorName;
    const char* compactRoomName = doc["roomName"] | "-";
    const char* nestedRoomName = doc["room"]["room_name"] | "";
    const char* roomName = strlen(nestedRoomName) > 0 ? nestedRoomName : compactRoomName;

    if (strlen(displayName) == 0) displayName = compactName;
    if (strlen(displayName) == 0) displayName = "Unknown";

    showRFIDLCD(
      String("Valid ") + personType,
      String(displayName),
      String("Room: ") + roomName,
      "Dashboard Sent"
    );
    scheduleRFIDLCDReset();
  } else {
    showRFIDLCD("Invalid Card", message, hardwareUid, "");
    scheduleRFIDLCDReset();
  }
}

// ================= RFID TEXT READ =================
String escapeJson(const String& input) {
  String output;
  output.reserve(input.length() + 8);

  for (size_t i = 0; i < input.length(); i++) {
    char ch = input.charAt(i);
    if (ch == '\\' || ch == '"') output += '\\';
    output += ch;
  }

  return output;
}

String extractResidentUid(const String& rawText) {
  int start = rawText.indexOf("RES-");
  if (start < 0) return "";

  String value = "";
  for (int i = start; i < rawText.length(); i++) {
    char ch = rawText.charAt(i);

    if (
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= '0' && ch <= '9') ||
      ch == '-'
    ) {
      value += ch;
    } else if (value.length() > 0) {
      break;
    }
  }

  value.trim();
  return value;
}

String bytesToPrintableText(byte* data, byte length) {
  String text = "";

  for (byte i = 0; i < length; i++) {
    byte value = data[i];
    if (value == 0x00 || value == 0xFE || value == 0xFF) continue;
    if (value >= 32 && value <= 126) text += (char)value;
  }

  return text;
}

void loadMifareKey(byte keyIndex) {
  for (byte i = 0; i < 6; i++) {
    mifareKey.keyByte[i] = MIFARE_COMMON_KEYS[keyIndex][i];
  }
}

void printMifareKey(byte keyIndex) {
  for (byte i = 0; i < 6; i++) {
    if (MIFARE_COMMON_KEYS[keyIndex][i] < 0x10) Serial.print("0");
    Serial.print(MIFARE_COMMON_KEYS[keyIndex][i], HEX);
    if (i + 1 < 6) Serial.print(" ");
  }
}

bool authenticateMifareBlock(byte block) {
  for (byte keyIndex = 0; keyIndex < MIFARE_COMMON_KEY_COUNT; keyIndex++) {
    loadMifareKey(keyIndex);

    MFRC522::StatusCode authA = rfid.PCD_Authenticate(
      MFRC522::PICC_CMD_MF_AUTH_KEY_A,
      block,
      &mifareKey,
      &(rfid.uid)
    );

    if (authA == MFRC522::STATUS_OK) {
      Serial.print("MIFARE block ");
      Serial.print(block);
      Serial.print(" authenticated with Key A ");
      printMifareKey(keyIndex);
      Serial.println();
      return true;
    }

    rfid.PCD_StopCrypto1();
    delay(10);

    MFRC522::StatusCode authB = rfid.PCD_Authenticate(
      MFRC522::PICC_CMD_MF_AUTH_KEY_B,
      block,
      &mifareKey,
      &(rfid.uid)
    );

    if (authB == MFRC522::STATUS_OK) {
      Serial.print("MIFARE block ");
      Serial.print(block);
      Serial.print(" authenticated with Key B ");
      printMifareKey(keyIndex);
      Serial.println();
      return true;
    }

    rfid.PCD_StopCrypto1();
    delay(10);
  }

  Serial.print("MIFARE auth failed for block ");
  Serial.print(block);
  Serial.println(" with common keys.");
  return false;
}

String readMifareClassicText() {
  const byte blocks[] = {4, 5, 6};
  String combinedText = "";

  for (byte i = 0; i < sizeof(blocks); i++) {
    byte block = blocks[i];

    if (!authenticateMifareBlock(block)) {
      return "";
    }

    byte buffer[18];
    byte size = sizeof(buffer);
    MFRC522::StatusCode readStatus = rfid.MIFARE_Read(block, buffer, &size);

    if (readStatus != MFRC522::STATUS_OK) {
      Serial.print("MIFARE read failed: ");
      Serial.println(rfid.GetStatusCodeName(readStatus));
      rfid.PCD_StopCrypto1();
      return "";
    }

    combinedText += bytesToPrintableText(buffer, 16);
    rfid.PCD_StopCrypto1();
  }

  rfid.PCD_StopCrypto1();
  combinedText.trim();
  return extractResidentUid(combinedText);
}

String readUltralightOrNtagText() {
  String rawText = "";

  for (byte page = 4; page <= 40; page += 4) {
    byte buffer[18];
    byte size = sizeof(buffer);
    MFRC522::StatusCode readStatus = rfid.MIFARE_Read(page, buffer, &size);

    if (readStatus != MFRC522::STATUS_OK) break;

    rawText += bytesToPrintableText(buffer, 16);
  }

  rawText.trim();
  return extractResidentUid(rawText);
}

String readCardCodeText() {
  MFRC522::PICC_Type piccType = rfid.PICC_GetType(rfid.uid.sak);

  Serial.print("Card type: ");
  Serial.println(rfid.PICC_GetTypeName(piccType));

  if (
    piccType == MFRC522::PICC_TYPE_MIFARE_MINI ||
    piccType == MFRC522::PICC_TYPE_MIFARE_1K ||
    piccType == MFRC522::PICC_TYPE_MIFARE_4K
  ) {
    return readMifareClassicText();
  }

  if (piccType == MFRC522::PICC_TYPE_MIFARE_UL) {
    return readUltralightOrNtagText();
  }

  return "";
}

void setupRFID() {
  SPI.begin(RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN, RFID_SS_PIN);
  rfid.PCD_Init();
  delay(50);
  rfid.PCD_AntennaOn();

  for (byte i = 0; i < 6; i++) {
    mifareKey.keyByte[i] = 0xFF;
  }

  byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.println("RFID RC522 Ready");
  Serial.print("RFID firmware version: 0x");
  Serial.println(version, HEX);

  if (version == 0x00 || version == 0xFF) {
    Serial.println("RFID WARNING: RC522 not responding. Check 3.3V, GND, SDA/SS, SCK, MOSI, MISO, RST wiring.");
  } else {
    Serial.println("RFID module detected. Put a card near the reader.");
  }

  showDefaultRFIDLCD();
}

String getCardHardwareUid() {
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

void printCardHardwareUid(const String& hardwareUid) {
  Serial.print("Card hardware UID: ");
  for (int i = 0; i < hardwareUid.length(); i++) {
    Serial.print(hardwareUid.charAt(i));
    if (i % 2 == 1 && i + 1 < hardwareUid.length()) Serial.print(":");
  }
  Serial.println();
}

bool publishRfidScan(String cardCode, String hardwareUid) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected");
    showRFIDLCD("RFID Failed", "WiFi Not Connected", hardwareUid, "");
    scheduleRFIDLCDReset();
    return false;
  }

  if (!client.connected()) {
    reconnectMQTT();
  }

  if (!client.connected()) {
    Serial.println("MQTT not connected");
    showRFIDLCD("RFID Failed", "MQTT Not Connected", hardwareUid, "");
    scheduleRFIDLCDReset();
    return false;
  }

  StaticJsonDocument<384> doc;
  doc["source"] = "rfid_scan";
  doc["deviceId"] = device_id;
  doc["responseTopic"] = topic_rfid_result;

  if (cardCode.length() > 0) {
    doc["cardCode"] = cardCode;
  }

  if (hardwareUid.length() > 0) {
    doc["hardwareUid"] = hardwareUid;
  }

  char buffer[384];
  serializeJson(doc, buffer);

  Serial.print("RFID MQTT Send: ");
  Serial.println(buffer);

  bool ok = client.publish(topic_rfid_scan, buffer);

  if (ok) {
    Serial.println("RFID MQTT published");
    showRFIDLCD("RFID Sent", "MQTT Published", hardwareUid, "Waiting Result");
    scheduleRFIDLCDReset(RFID_LCD_WAIT_RESULT_TIMEOUT_MS);
  } else {
    Serial.println("RFID MQTT publish failed");
    showRFIDLCD("RFID Failed", "MQTT Publish Error", hardwareUid, "");
    scheduleRFIDLCDReset();
  }

  return ok;
}

void handleRFID() {
  if (!rfid.PICC_IsNewCardPresent()) {
    if (millis() - lastRFIDDebugPrint >= RFID_DEBUG_INTERVAL) {
      lastRFIDDebugPrint = millis();
      Serial.println("RFID waiting for card...");
    }
    return;
  }

  Serial.println("RFID card field detected.");

  if (!rfid.PICC_ReadCardSerial()) {
    Serial.println("RFID card detected, but serial read failed. Hold card still and closer to RC522.");
    return;
  }

  String hardwareUid = getCardHardwareUid();
  printCardHardwareUid(hardwareUid);

  String cardCode = readCardCodeText();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  if (cardCode.length() == 0) {
    Serial.println("No resident_uid text found on card.");
    Serial.print("Using hardwareUid fallback: ");
    Serial.println(hardwareUid);
  }

  String lookupKey = cardCode.length() > 0 ? cardCode : hardwareUid;

  if (lookupKey == lastCardCode && millis() - lastRFIDScanTime < RFID_COOLDOWN) {
    return;
  }

  if (cardCode.length() > 0) {
    Serial.print("RFID cardCode: ");
    Serial.println(cardCode);
  }
  Serial.print("RFID hardwareUid: ");
  Serial.println(hardwareUid);

  showRFIDLCD("RFID Scanned", "Publishing MQTT", lookupKey.substring(0, 20), "");
  bool published = publishRfidScan(cardCode, hardwareUid);

  if (published) {
    lastCardCode = lookupKey;
    lastRFIDScanTime = millis();
  } else {
    Serial.println("RFID MQTT send failed. Same card can be retried immediately.");
  }
}

// ================= VISITOR PARKING =================
void handleVisitorParking() {
  bool r1 = detected(VIS_R1);
  bool r2 = detected(VIS_R2);

  if (!visitorProcessing && millis() - lastVisitorEvent > EVENT_COOLDOWN) {
    if (r1 && !r2) {
      visitorProcessing = true;
      visitorState = 1;
      visitorStartTime = millis();

      visitorServo.write(GATE_OPEN_ANGLE);
      showParkingLCD("Welcome Visitor", "Gate Opening...", "Please Enter", "");
      Serial.println("Visitor ENTRY start: R1 detected, gate open");

      waitRelease(VIS_R1);
    } else if (r2 && !r1) {
      visitorProcessing = true;
      visitorState = 2;
      visitorStartTime = millis();

      visitorServo.write(GATE_OPEN_ANGLE);
      showParkingLCD("Visitor Exit", "Gate Opening...", "Drive Safely", "");
      Serial.println("Visitor EXIT start: R2 detected, gate open");

      waitRelease(VIS_R2);
    }
  }

  if (!visitorProcessing) return;

  if (millis() - visitorStartTime > SENSOR_TIMEOUT) {
    showParkingLCD("Visitor Timeout", "Gate Closing...", "", "");
    closeVisitorGate();

    visitorProcessing = false;
    visitorState = 0;
    lastVisitorEvent = millis();

    waitBothRelease(VIS_R1, VIS_R2);
    showDefaultParkingLCD();
    return;
  }

  if (visitorState == 1 && detected(VIS_R2)) {
    publishParkingDelta("visitor", 1);
    showParkingLCD("Welcome Visitor", "Entry Complete", "Gate Closing...", "");

    closeVisitorGate();
    waitBothRelease(VIS_R1, VIS_R2);

    visitorProcessing = false;
    visitorState = 0;
    lastVisitorEvent = millis();

    showDefaultParkingLCD();
  }

  if (visitorState == 2 && detected(VIS_R1)) {
    publishParkingDelta("visitor", -1);
    showParkingLCD("Thank You Visitor", "Exit Complete", "Gate Closing...", "");

    closeVisitorGate();
    waitBothRelease(VIS_R1, VIS_R2);

    visitorProcessing = false;
    visitorState = 0;
    lastVisitorEvent = millis();

    showDefaultParkingLCD();
  }
}

// ================= RESIDENT PARKING =================
void handleResidentParking() {
  bool r3 = detected(RES_R3);
  bool r4 = detected(RES_R4);

  if (!residentProcessing && millis() - lastResidentEvent > EVENT_COOLDOWN) {
    if (r3 && !r4) {
      residentProcessing = true;
      residentState = 1;
      residentStartTime = millis();

      residentServo.write(GATE_OPEN_ANGLE);
      showParkingLCD("Welcome", "Residential", "Gate Opening...", "Please Enter");
      Serial.println("Resident ENTRY start: R3 detected, gate open");

      waitRelease(RES_R3);
    } else if (r4 && !r3) {
      residentProcessing = true;
      residentState = 2;
      residentStartTime = millis();

      residentServo.write(GATE_OPEN_ANGLE);
      showParkingLCD("Resident Exit", "Gate Opening...", "Drive Safely", "");
      Serial.println("Resident EXIT start: R4 detected, gate open");

      waitRelease(RES_R4);
    }
  }

  if (!residentProcessing) return;

  if (millis() - residentStartTime > SENSOR_TIMEOUT) {
    showParkingLCD("Resident Timeout", "Gate Closing...", "", "");
    closeResidentGate();

    residentProcessing = false;
    residentState = 0;
    lastResidentEvent = millis();

    waitBothRelease(RES_R3, RES_R4);
    showDefaultParkingLCD();
    return;
  }

  if (residentState == 1 && detected(RES_R4)) {
    publishParkingDelta("resident", 1);
    showParkingLCD("Welcome", "Residential", "Entry Complete", "Gate Closing...");

    closeResidentGate();
    waitBothRelease(RES_R3, RES_R4);

    residentProcessing = false;
    residentState = 0;
    lastResidentEvent = millis();

    showDefaultParkingLCD();
  }

  if (residentState == 2 && detected(RES_R3)) {
    publishParkingDelta("resident", -1);
    showParkingLCD("Thank You", "Residential", "Exit Complete", "Gate Closing...");

    closeResidentGate();
    waitBothRelease(RES_R3, RES_R4);

    residentProcessing = false;
    residentState = 0;
    lastResidentEvent = millis();

    showDefaultParkingLCD();
  }
}

// ================= SOS =================
void handleSOS() {
  if (digitalRead(SOS_BUTTON_PIN) == LOW) {
    digitalWrite(BUZZER_PIN, HIGH);

    if (!sosSent) {
      publishSOS();
      sosSent = true;
      showParkingLCD("SOS ALERT!", "Emergency Button", "Pressed", "");
      Serial.println("SOS SENT");
    }
  } else {
    digitalWrite(BUZZER_PIN, LOW);
    sosSent = false;
  }
}

// ================= DEBUG =================
void printSensorDebug() {
  static unsigned long lastPrint = 0;

  if (millis() - lastPrint >= 1000) {
    lastPrint = millis();

    Serial.print("R1=");
    Serial.print(digitalRead(VIS_R1));
    Serial.print(" R2=");
    Serial.print(digitalRead(VIS_R2));
    Serial.print(" R3=");
    Serial.print(digitalRead(RES_R3));
    Serial.print(" R4=");
    Serial.println(digitalRead(RES_R4));
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("Booting ESP32 Parking + RFID System...");
  Serial.println("Serial baud: 115200");

  selectParkingLCD();
  parkingLCD.init();
  parkingLCD.backlight();

  selectRFIDLCD();
  rfidLCD.init();
  rfidLCD.backlight();

  showParkingLCD("Car Parking", "Starting System...", "", "");
  showDefaultRFIDLCD();

  pinMode(VIS_R1, INPUT_PULLUP);
  pinMode(VIS_R2, INPUT_PULLUP);
  pinMode(RES_R3, INPUT_PULLUP);
  pinMode(RES_R4, INPUT_PULLUP);

  pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);

  visitorServo.setPeriodHertz(50);
  residentServo.setPeriodHertz(50);

  visitorServo.attach(VIS_SERVO_PIN, 500, 2400);
  residentServo.attach(RES_SERVO_PIN, 500, 2400);

  visitorServo.write(GATE_CLOSE_ANGLE);
  residentServo.write(GATE_CLOSE_ANGLE);

  setupRFID();

  setupWiFi();

  espClient.setInsecure();
  client.setServer(mqtt_server, mqtt_port);
  client.setBufferSize(1024);
  client.setCallback(handleMqttMessage);
  reconnectMQTT();

  showDefaultParkingLCD();

  Serial.println("ESP32 Parking + RFID System Ready");
}

// ================= LOOP =================
void loop() {
  if (!client.connected()) {
    reconnectMQTT();
  }

  client.loop();

  handleRFIDLCDReset();
  printSensorDebug();
  handleSOS();
  handleRFID();
  handleVisitorParking();
  handleResidentParking();
}
