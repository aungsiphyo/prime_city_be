#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ESP32QRCodeReader.h>

// ================= WIFI =================
const char* WIFI_SSID = "KoMyo";
const char* WIFI_PASSWORD = "0995138020";

// ================= BACKEND =================
const char* SCAN_ENDPOINT =
    "https://smart-residential.onrender.com/api/qr-scan";

// ================= QR READER =================
ESP32QRCodeReader reader(CAMERA_MODEL_AI_THINKER);

// ================= DUPLICATE CONTROL =================
String lastPayload = "";
unsigned long lastScanAt = 0;
const unsigned long DUPLICATE_COOLDOWN_MS = 5000;

// ================= JSON ESCAPE =================
String escapeJson(const String &input) {
  String output;

  for (size_t i = 0; i < input.length(); i++) {
    char ch = input.charAt(i);

    if (ch == '\\' || ch == '"')
      output += '\\';

    output += ch;
  }

  return output;
}

// ================= WIFI =================
void connectWiFi() {

  if (WiFi.status() == WL_CONNECTED)
    return;

  Serial.println();
  Serial.println("Connecting WiFi...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - start < 20000) {

    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {

    Serial.println("WiFi Connected");
    Serial.print("IP : ");
    Serial.println(WiFi.localIP());

  } else {

    Serial.println("WiFi Failed");

  }
}

// ================= SEND TO SERVER =================
void sendQrToServer(const String &payload) {

  connectWiFi();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("No WiFi");
    return;
  }

  WiFiClientSecure client;

  // Demo / Hackathon
  client.setInsecure();

  HTTPClient http;

  http.setTimeout(10000);

  Serial.print("POST : ");
  Serial.println(SCAN_ENDPOINT);

  if (!http.begin(client, SCAN_ENDPOINT)) {

    Serial.println("HTTP Begin Failed");

    return;
  }

  http.addHeader("Content-Type", "application/json");

  String body =
      "{\"token\":\"" +
      escapeJson(payload) +
      "\"}";

  Serial.print("Body : ");
  Serial.println(body);

  int code = http.POST(body);

  String response = http.getString();

  Serial.print("Status : ");
  Serial.println(code);

  Serial.print("Response : ");
  Serial.println(response);

  http.end();

  switch (code) {

    case 200:

      Serial.println("Visitor Accepted");
      break;

    case 400:

      Serial.println("Bad Request");
      break;

    case 401:

      Serial.println("Invalid QR");
      break;

    default:

      Serial.println("Server Error");
      break;
  }
}

// ================= QR TASK =================
void qrTask(void *pvParameters) {

  struct QRCodeData qr;

  while (true) {

    if (reader.receiveQrCode(&qr, 100)) {

      if (!qr.valid) {

        Serial.println("Invalid QR");

        vTaskDelay(300 / portTICK_PERIOD_MS);

        continue;
      }

      String payload = String((char *)qr.payload);

      payload.trim();

      Serial.println();
      Serial.println("QR Detected");
      Serial.println(payload);

      unsigned long now = millis();

      if (payload == lastPayload &&
          now - lastScanAt < DUPLICATE_COOLDOWN_MS) {

        Serial.println("Duplicate Ignored");

        vTaskDelay(300 / portTICK_PERIOD_MS);

        continue;
      }

      lastPayload = payload;
      lastScanAt = now;

      sendQrToServer(payload);
    }

    if (WiFi.status() != WL_CONNECTED)
      connectWiFi();

    vTaskDelay(150 / portTICK_PERIOD_MS);
  }
}

// ================= SETUP =================
void setup() {

  Serial.begin(115200);

  delay(2000);

  Serial.println();
  Serial.println("============================");
  Serial.println("ESP32 Visitor QR Scanner");
  Serial.println("============================");

  connectWiFi();

  reader.setup();

  reader.beginOnCore(1);

  xTaskCreate(
      qrTask,
      "QRTask",
      6144,
      NULL,
      4,
      NULL);

  Serial.println("QR Scanner Ready");
}

// ================= LOOP =================
void loop() {

  delay(1000);

}