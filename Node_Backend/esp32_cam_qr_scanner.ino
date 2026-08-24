#include <ESP32QRCodeReader.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

// ================= WIFI =================
const char* WIFI_SSID = "KoMyo";
const char* WIFI_PASSWORD = "0995138020";

// ================= BACKEND =================
// This endpoint accepts both:
// 1. the existing static walk-in badge (shows the registration-form QR), and
// 2. the signed one-time pre-registration QR (shows visitor details directly).
const char* SCAN_ENDPOINT =
    "https://54.87.203.253.sslip.io/api/qr-scan";

// ================= QR READER =================
ESP32QRCodeReader reader(CAMERA_MODEL_AI_THINKER);

// ================= DUPLICATE CONTROL =================
String lastPayload = "";
unsigned long lastScanAt = 0;
const unsigned long DUPLICATE_COOLDOWN_MS = 5000;

// ================= JSON ESCAPE =================
String escapeJson(const String& input) {
  String output;
  output.reserve(input.length() + 8);

  for (size_t i = 0; i < input.length(); i++) {
    char ch = input.charAt(i);

    if (ch == '\\' || ch == '"') {
      output += '\\';
    }

    output += ch;
  }

  return output;
}

// ================= WIFI CONNECT =================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.println();
  Serial.print("Connecting WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startedAt = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 20000) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("✅ WiFi Connected");
    Serial.print("ESP32-CAM IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("❌ WiFi Connection Failed");
  }
}

// ================= SEND QR TO SERVER =================
int sendQrToServer(const String& qrPayload) {
  connectWiFi();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ Cannot send QR. WiFi not connected.");
    return -1;
  }

  WiFiClientSecure client;

  // Hackathon/demo setup. For production, install the server CA certificate
  // with client.setCACert(...) instead of disabling certificate validation.
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(10000);

  Serial.print("POST URL: ");
  Serial.println(SCAN_ENDPOINT);

  if (!http.begin(client, SCAN_ENDPOINT)) {
    Serial.println("❌ HTTP begin failed");
    return -2;
  }

  http.addHeader("Content-Type", "application/json");

  String body = "{\"token\":\"" + escapeJson(qrPayload) + "\"}";

  Serial.print("Sending Body: ");
  Serial.println(body);

  int statusCode = http.POST(body);
  String response = http.getString();

  Serial.print("HTTP Status: ");
  Serial.println(statusCode);

  Serial.print("Response: ");
  Serial.println(response);

  switch (statusCode) {
    case 200:
      Serial.println("✅ QR accepted; reception display updated.");
      break;
    case 400:
      Serial.println("❌ Bad QR request.");
      break;
    case 401:
      Serial.println("❌ Invalid or inactive visitor QR.");
      break;
    case 409:
      Serial.println("❌ This one-time visitor QR was already used.");
      break;
    case 410:
      Serial.println("❌ This visitor QR has expired.");
      break;
    default:
      if (statusCode <= 0) {
        Serial.print("⚠️ HTTP connection error: ");
        Serial.println(http.errorToString(statusCode));
      } else {
        Serial.println("⚠️ Server error or unexpected response.");
      }
      break;
  }

  http.end();
  return statusCode;
}

// ================= QR TASK =================
void onQrCodeTask(void* pvParameters) {
  struct QRCodeData qrCodeData;

  while (true) {
    if (reader.receiveQrCode(&qrCodeData, 100)) {
      Serial.println();
      Serial.println("📷 QR Code Detected");

      if (!qrCodeData.valid) {
        Serial.print("❌ Invalid QR Payload: ");
        Serial.println((const char*)qrCodeData.payload);
        vTaskDelay(300 / portTICK_PERIOD_MS);
        continue;
      }

      String payload = String((const char*)qrCodeData.payload);
      payload.trim();

      Serial.print("Decoded QR Payload: ");
      Serial.println(payload);

      unsigned long now = millis();

      if (payload == lastPayload && now - lastScanAt < DUPLICATE_COOLDOWN_MS) {
        Serial.println("⚠️ Duplicate Visitor QR ignored");
        vTaskDelay(300 / portTICK_PERIOD_MS);
        continue;
      }

      // The backend decides whether this is the preserved walk-in badge flow
      // or a signed pre-registered visitor pass.
      const int statusCode = sendQrToServer(payload);

      // Do not suppress an immediate retry when WiFi/HTTP never reached the
      // backend. Server responses still use the normal duplicate cooldown.
      if (statusCode > 0) {
        lastPayload = payload;
        lastScanAt = now;
      }
    }

    if (WiFi.status() != WL_CONNECTED) {
      connectWiFi();
    }

    vTaskDelay(150 / portTICK_PERIOD_MS);
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("=================================");
  Serial.println("ESP32-CAM Visitor QR Scanner");
  Serial.println("=================================");

  connectWiFi();

  Serial.println("Starting QR Reader...");
  reader.setup();
  reader.beginOnCore(1);

  xTaskCreate(
    onQrCodeTask,
    "onQrCodeTask",
    6 * 1024,
    NULL,
    4,
    NULL
  );

  Serial.println("✅ ESP32-CAM Ready");
  Serial.println("Scan a walk-in badge or pre-registered visitor QR.");
}

// ================= LOOP =================
void loop() {
  delay(1000);
}
