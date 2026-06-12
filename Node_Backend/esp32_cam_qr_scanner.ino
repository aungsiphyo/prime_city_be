#include <WiFi.h>
#include <HTTPClient.h>
#include <ESP32QRCodeReader.h>

// ================= WIFI =================
const char* WIFI_SSID = "Redmi Note 13 Pro";
const char* WIFI_PASSWORD = "11111111";

// ================= BACKEND =================
// Laptop / Backend IP ကို server log ထဲက Register IP နဲ့ ပြောင်းပါ
// Example: Register : http://10.139.242.187:5001/register
const char* SCAN_ENDPOINT = "http://10.139.242.187:5001/api/qr-scan";

// Visitor က ပြမယ့် Default QR ထဲက token
// server.js ထဲက VALID_QR_TOKEN နဲ့ တူရမယ်
const char* VISITOR_BADGE_TOKEN = "VISITOR_ACCESS_2024_SECRET";

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
void sendQrToServer(const String& qrPayload) {
  connectWiFi();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ Cannot send QR. WiFi not connected.");
    return;
  }

  HTTPClient http;
  http.setTimeout(8000);

  Serial.print("POST URL: ");
  Serial.println(SCAN_ENDPOINT);

  if (!http.begin(SCAN_ENDPOINT)) {
    Serial.println("❌ HTTP begin failed");
    return;
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

  http.end();

  if (statusCode == 200) {
    Serial.println("✅ Visitor QR accepted.");
    Serial.println("✅ Laptop/Tablet display should show Registration QR.");
  } else if (statusCode == 401) {
    Serial.println("❌ Invalid Visitor QR Token");
  } else if (statusCode == 400) {
    Serial.println("❌ No token or bad request");
  } else {
    Serial.println("⚠️ Server error or network issue");
  }
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

      lastPayload = payload;
      lastScanAt = now;

      // Visitor default QR ကို backend ဆီပို့
      sendQrToServer(payload);
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
  Serial.println("Visitor should show Default QR Badge.");
}

// ================= LOOP =================
void loop() {
  delay(1000);
}