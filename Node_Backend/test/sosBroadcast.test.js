const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildApprovedEmergencyPayload,
  getBroadcastStatus,
} = require("../src/services/sosBroadcast.service");

test("approved SOS payload is an urgent mobile emergency with trace data", () => {
  const approvedAt = new Date("2026-08-25T10:00:00.000Z");
  const payload = buildApprovedEmergencyPayload(
    {
      _id: "sos-1",
      alert_type: "Fire",
      priority: "Critical",
      message: "Smoke detected",
      source: "ESP32",
      device_id: "gate-device-1",
      room_id: { _id: "room-1", room_name: "A-101" },
    },
    "admin-1",
    approvedAt,
  );

  assert.equal(payload.type, "Emergency");
  assert.equal(payload.title, "Verified emergency: Fire");
  assert.match(payload.message, /Smoke detected/);
  assert.match(payload.message, /A-101/);
  assert.deepEqual(payload.data, {
    event: "SOS_APPROVED",
    sos_id: "sos-1",
    status: "Approved",
    alert_type: "Fire",
    priority: "Critical",
    source: "ESP32",
    device_id: "gate-device-1",
    room_id: "room-1",
    room_label: "A-101",
    approved_by: "admin-1",
    approved_at: approvedAt.toISOString(),
  });
});

test("push delivery state distinguishes sent, partial and failed broadcasts", () => {
  assert.equal(getBroadcastStatus({ success: true, failureCount: 0 }, 3), "Sent");
  assert.equal(
    getBroadcastStatus({ success: true, failureCount: 1 }, 3),
    "Partial",
  );
  assert.equal(
    getBroadcastStatus({ success: false, skipped: true }, 3),
    "Partial",
  );
  assert.equal(getBroadcastStatus({ success: false }, 0), "Failed");
});
