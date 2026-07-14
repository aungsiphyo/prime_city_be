#include <WiFi.h>
#include <WiFiClientSecure.h>
#define MQTT_MAX_PACKET_SIZE 1024
#include <PubSubClient.h>
#include <SPI.h>
#include <MFRC522.h>

// ================= WIFI =================
const char* WIFI_SSID = "KoMyo";
const char* WIFI_PASSWORD = "0995138020";

// ================= MQTT =================
const char* MQTT_SERVER = "18ae47c8570f47e183ae798b2758364f.s1.eu.hivemq.cloud";
const int MQTT_PORT = 8883;
const char* MQTT_USER = "smartSOS";
const char* MQTT_PASS = "Password123";
const char* RFID_SCAN_TOPIC = "rfid/scan";
const char* RFID_RESULT_TOPIC = "rfid/scan/result/esp32_mfrc522_reader";
const char* DEVICE_ID = "esp32_mfrc522_reader";
const char* SKETCH_VERSION = "rfid-mqtt-2026-06-20-1";

// ================= MFRC522 PINS =================
// Same wiring as the full parking + RFID sketch.
#define RFID_SS_PIN 5
#define RFID_RST_PIN 4
#define RFID_SCK_PIN 32
#define RFID_MOSI_PIN 33
#define RFID_MISO_PIN 35

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);
MFRC522::MIFARE_Key mifareKey;
WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);

String lastCardCode = "";
unsigned long lastScanAt = 0;
unsigned long lastRFIDDebugAt = 0;
unsigned long lastMQTTRetryAt = 0;
const unsigned long DUPLICATE_COOLDOWN_MS = 5000;
const unsigned long RFID_DEBUG_INTERVAL_MS = 2000;
const unsigned long MQTT_RETRY_INTERVAL_MS = 5000;

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

void printWiFiDiagnostics() {
  Serial.print("WiFi status: ");
  Serial.println(WiFi.status());
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("Gateway: ");
  Serial.println(WiFi.gatewayIP());
  Serial.print("Subnet: ");
  Serial.println(WiFi.subnetMask());
  Serial.print("RSSI: ");
  Serial.println(WiFi.RSSI());
  Serial.print("MQTT server: ");
  Serial.println(MQTT_SERVER);
  Serial.print("MQTT port: ");
  Serial.println(MQTT_PORT);
  Serial.print("RFID MQTT topic: ");
  Serial.println(RFID_SCAN_TOPIC);
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

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    printWiFiDiagnostics();
    return;
  }

  Serial.print("Connecting WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 20000) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
    printWiFiDiagnostics();
  } else {
    Serial.println("WiFi connection failed");
  }
}

bool reconnectMQTT() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("MQTT skipped: WiFi not connected.");
    return false;
  }

  if (mqttClient.connected()) return true;

  if (
    lastMQTTRetryAt > 0 &&
    millis() - lastMQTTRetryAt < MQTT_RETRY_INTERVAL_MS
  ) {
    return false;
  }

  lastMQTTRetryAt = millis();

  Serial.print("Connecting MQTT... ");

  String clientId = String(DEVICE_ID) + "_" + String(random(0xffff), HEX);

  if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
    Serial.println("Connected");
    mqttClient.subscribe(RFID_RESULT_TOPIC);
    Serial.print("Subscribed MQTT result topic: ");
    Serial.println(RFID_RESULT_TOPIC);
    return true;
  }

  Serial.print("Failed, rc=");
  Serial.println(mqttClient.state());
  return false;
}

void handleMqttMessage(char* topic, byte* payload, unsigned int length) {
  Serial.print("MQTT message on ");
  Serial.print(topic);
  Serial.print(": ");

  for (unsigned int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
  }

  Serial.println();
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
  // Store plain text resident_uid across data blocks 4, 5, 6.
  // Do not use sector trailer blocks: 3, 7, 11, ...
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
  // NTAG/Ultralight NDEF data usually starts at page 4.
  // This scans printable bytes and extracts the first RES-... value.
  String rawText = "";

  for (byte page = 4; page <= 40; page += 4) {
    byte buffer[18];
    byte size = sizeof(buffer);
    MFRC522::StatusCode readStatus = rfid.MIFARE_Read(page, buffer, &size);

    if (readStatus != MFRC522::STATUS_OK) {
      Serial.print("NTAG page read stopped at page ");
      Serial.print(page);
      Serial.print(": ");
      Serial.println(rfid.GetStatusCodeName(readStatus));
      break;
    }

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

  Serial.println("Unsupported card type for text read.");
  return "";
}

bool publishRfidScan(const String& cardCode, const String& hardwareUid) {
  connectWiFi();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot validate card. WiFi not connected.");
    return false;
  }

  if (!reconnectMQTT()) {
    Serial.println("Cannot validate card. MQTT not connected.");
    return false;
  }

  String body = "{\"source\":\"rfid_scan\"";
  body += ",\"deviceId\":\"" + escapeJson(DEVICE_ID) + "\"";
  body += ",\"responseTopic\":\"" + escapeJson(RFID_RESULT_TOPIC) + "\"";
  if (cardCode.length() > 0) {
    body += ",\"cardCode\":\"" + escapeJson(cardCode) + "\"";
  }
  if (hardwareUid.length() > 0) {
    body += ",\"hardwareUid\":\"" + escapeJson(hardwareUid) + "\"";
  }
  body += "}";

  Serial.print("RFID MQTT Send: ");
  Serial.println(body);

  bool ok = mqttClient.publish(RFID_SCAN_TOPIC, body.c_str());
  if (ok) Serial.println("RFID MQTT published.");
  else Serial.println("RFID MQTT publish failed.");

  return ok;
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
  Serial.print("RFID firmware version: 0x");
  Serial.println(version, HEX);

  if (version == 0x00 || version == 0xFF) {
    Serial.println("RFID WARNING: RC522 not responding. Check 3.3V, GND, SDA/SS, SCK, MOSI, MISO, RST wiring.");
  } else {
    Serial.println("RFID module detected.");
  }
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

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("ESP32 MFRC522 Resident Card Reader");
  Serial.println("Serial baud: 115200");
  Serial.print("Sketch version: ");
  Serial.println(SKETCH_VERSION);
  setupRFID();
  espClient.setInsecure();
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(handleMqttMessage);
  connectWiFi();
  reconnectMQTT();

  Serial.println("Ready. Put a resident RFID/NFC card near MFRC522.");
  Serial.println("MIFARE Classic: write resident_uid as plain text to blocks 4,5,6.");
  Serial.println("NTAG/Ultralight: write resident_uid as NDEF text.");
}

void loop() {
  if (mqttClient.connected()) {
    mqttClient.loop();
  } else if (WiFi.status() == WL_CONNECTED) {
    reconnectMQTT();
  }

  if (!rfid.PICC_IsNewCardPresent()) {
    if (millis() - lastRFIDDebugAt >= RFID_DEBUG_INTERVAL_MS) {
      lastRFIDDebugAt = millis();
      Serial.println("RFID waiting for card...");
    }
    delay(50);
    return;
  }

  Serial.println("RFID card field detected.");

  if (!rfid.PICC_ReadCardSerial()) {
    Serial.println("RFID card detected, but serial read failed. Hold card still and closer to RC522.");
    delay(250);
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

  unsigned long now = millis();
  String lookupKey = cardCode.length() > 0 ? cardCode : hardwareUid;

  if (lookupKey == lastCardCode && now - lastScanAt < DUPLICATE_COOLDOWN_MS) {
    Serial.println("Duplicate card ignored.");
    delay(250);
    return;
  }

  if (cardCode.length() > 0) {
    Serial.print("Resident cardCode: ");
    Serial.println(cardCode);
  }
  Serial.print("Resident hardwareUid: ");
  Serial.println(hardwareUid);
  bool published = publishRfidScan(cardCode, hardwareUid);
  if (published) {
    lastCardCode = lookupKey;
    lastScanAt = now;
  } else {
    Serial.println("RFID MQTT send failed. Same card can be retried immediately.");
  }

  delay(250);
}
