const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

test("reception display keeps walk-in QR and pre-registration event flows", () => {
  const display = read("public/display.html");

  assert.match(display, /addEventListener\("unlock"/);
  assert.match(display, /showQR\(url \|\| registerUrl/);
  assert.match(display, /addEventListener\("pre_registered_visitor"/);
  assert.match(display, /showPreRegisteredVisitor\(JSON\.parse\(e\.data\)\)/);
});

test("QR scan endpoint preserves the walk-in badge and emits verified visitor data", () => {
  const server = read("server.js");

  assert.match(server, /token === VALID_QR_TOKEN/);
  assert.match(server, /broadcastSSE\("unlock"/);
  assert.match(server, /verifyVisitorQrToken\(token\)/);
  assert.match(server, /qr_status:\s*"Used"/);
  assert.match(server, /broadcastSSE\("pre_registered_visitor", displayData\)/);
});

test("ESP32-CAM posts QR payloads to the production HTTPS scan endpoint", () => {
  for (const sketch of ["esp32_cam_qr_scanner.ino", "esp32/Cam.ino"]) {
    const source = read(sketch);
    assert.match(
      source,
      /https:\/\/54\.87\.203\.253\.sslip\.io\/api\/qr-scan/
    );
    assert.match(source, /WiFiClientSecure client/);
    assert.match(source, /http\.begin\(client, SCAN_ENDPOINT\)/);
    assert.match(
      source,
      /String body = "\{\\"token\\":\\"" \+ escapeJson\([a-zA-Z]+\) \+ "\\"\}"/
    );
  }
});
