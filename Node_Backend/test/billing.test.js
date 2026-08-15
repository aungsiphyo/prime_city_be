const test = require("node:test");
const assert = require("node:assert/strict");
const {
  amountsMatch,
  buildBillingKey,
  calculateBillTotal,
  canSubmitPaymentForBill,
} = require("../src/services/billing.service");
const {
  ROOM_PRICES,
  calculatePropertyFinance,
  getMonthlyInstallment,
} = require("../src/services/propertyFinance.service");

test("room prices use a 40 percent deposit and a 60 month finance plan", () => {
  const expectedMonthly = {
    Business: 5_000_000,
    Office: 10_000_000,
    Standard: 2_000_000,
    Premium: 3_000_000,
  };

  Object.entries(ROOM_PRICES).forEach(([roomType, price]) => {
    const finance = calculatePropertyFinance(roomType);
    assert.equal(finance.purchase_price, price);
    assert.equal(finance.down_payment_amount, price * 0.4);
    assert.equal(finance.financed_amount, price * 0.6);
    assert.equal(finance.installment_months, 60);
    assert.equal(finance.monthly_installment_amount, expectedMonthly[roomType]);
  });
});

test("monthly installment becomes zero only after the room plan is paid", () => {
  assert.equal(
    getMonthlyInstallment({ room_type: "Standard", installments_paid: 12 }),
    2_000_000,
  );
  assert.equal(
    getMonthlyInstallment({
      room_type: "Standard",
      installments_paid: 60,
      installment_status: "Paid",
    }),
    0,
  );
});
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
  assert.equal(
    buildBillingKey("room-a", 2026, 8, "Service Fee"),
    "room-a:2026-08:service-fee",
  );
  assert.equal(
    buildBillingKey("room-a", 2026, 8, "Apartment Installment"),
    "room-a:2026-08:apartment-installment",
  );
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
