const test = require("node:test");
const assert = require("node:assert/strict");
const {
  amountsMatch,
  buildBillingKey,
  calculateBillTotal,
  canSubmitPaymentForBill,
} = require("../src/services/billing.service");
const {
  canAccessPaymentProof,
  detectImageMime,
} = require("../src/routes/billPayment");

test("monthly bill total is calculated from server-side component fields", () => {
  assert.equal(
    calculateBillTotal({
      electricity_amount: 12500,
      water_amount: 4500,
      installment_amount: 200000,
      maintenance_amount: 10000,
      service_amount: 2500,
      other_amount: 500,
    }),
    230000,
  );
});

test("payment amount must exactly match the bill total", () => {
  assert.equal(amountsMatch(52000, "52000"), true);
  assert.equal(amountsMatch(52000, "51999.99"), false);
  assert.equal(amountsMatch(52000, "not-money"), false);
});

test("monthly billing key prevents duplicate room-month bills", () => {
  assert.equal(buildBillingKey("room-a", 2026, 8), "room-a:2026-08");
  assert.equal(buildBillingKey("room-a", 2026, 13), null);
});

test("payment cannot be resubmitted while pending review or after approval", () => {
  assert.equal(canSubmitPaymentForBill("Pending"), true);
  assert.equal(canSubmitPaymentForBill("Rejected"), true);
  assert.equal(canSubmitPaymentForBill("Payment Submitted"), false);
  assert.equal(canSubmitPaymentForBill("Under Review"), false);
  assert.equal(canSubmitPaymentForBill("Paid"), false);
});

test("private payment proof access is resident-owned and room-scoped", () => {
  const submission = { user_id: "resident-a", room_id: "room-a" };
  assert.equal(
    canAccessPaymentProof({
      currentUser: { _id: "resident-a", role: "Resident" },
      submission,
      roomId: "room-a",
    }),
    true,
  );
  assert.equal(
    canAccessPaymentProof({
      currentUser: { _id: "resident-b", role: "Resident" },
      submission,
      roomId: "room-b",
    }),
    false,
  );
  assert.equal(
    canAccessPaymentProof({
      currentUser: { _id: "admin-a", role: "Admin" },
      submission,
      roomId: null,
    }),
    true,
  );
});

test("payment proof type is validated from file bytes", () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
  const fake = Buffer.from("not-an-image");
  assert.equal(detectImageMime(png), "image/png");
  assert.equal(detectImageMime(fake), null);
});
