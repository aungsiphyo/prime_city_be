const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_SERVICE_FEE,
  PAYMENT_WINDOW_DAYS,
  buildMonthlyBillPayloads,
  getBillingPeriod,
} = require("../src/services/monthlyBilling.service");

test("monthly billing period follows Asia/Yangon month boundaries", () => {
  assert.deepEqual(getBillingPeriod(new Date("2026-08-31T17:29:59.000Z")), {
    year: 2026,
    month: 8,
  });
  assert.deepEqual(getBillingPeriod(new Date("2026-08-31T17:30:00.000Z")), {
    year: 2026,
    month: 9,
  });
});

test("occupied Standard room receives separate installment and service bills", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");
  const bills = buildMonthlyBillPayloads(
    {
      _id: "room-standard",
      room_type: "Standard",
      status: "Occupied",
      resident_id: "resident-flex",
      installments_paid: 0,
      installment_status: "Active",
    },
    { now },
  );

  assert.equal(bills.length, 2);
  const installment = bills.find(
    (bill) => bill.category === "Apartment Installment",
  );
  const service = bills.find((bill) => bill.category === "Service Fee");
  assert.equal(
    installment.billing_key,
    "room-standard:2026-08:apartment-installment",
  );
  assert.equal(installment.title, "August 2026 Apartment Installment");
  assert.equal(installment.installment_amount, 2_000_000);
  assert.equal(installment.service_amount, 0);
  assert.equal(installment.amount, 2_000_000);
  assert.equal(service.billing_key, "room-standard:2026-08:service-fee");
  assert.equal(service.installment_amount, 0);
  assert.equal(service.service_amount, DEFAULT_SERVICE_FEE);
  assert.equal(service.amount, DEFAULT_SERVICE_FEE);
  assert.ok(bills.every((bill) => bill.status === "Pending"));
  assert.ok(
    bills.every(
      (bill) =>
        bill.due_date.getTime() ===
        now.getTime() + PAYMENT_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
    ),
  );
});

test("paid installment plan still receives the monthly service fee", () => {
  const bills = buildMonthlyBillPayloads({
    _id: "room-paid",
    room_type: "Premium",
    status: "Occupied",
    resident_id: "resident-paid",
    installments_paid: 60,
    installment_status: "Paid",
  });

  assert.equal(bills.length, 1);
  assert.equal(bills[0].category, "Service Fee");
  assert.equal(bills[0].installment_amount, 0);
  assert.equal(bills[0].amount, DEFAULT_SERVICE_FEE);
});

test("available or unassigned rooms cannot receive an automatic bill", () => {
  assert.throws(
    () =>
      buildMonthlyBillPayloads({
        _id: "room-available",
        room_type: "Standard",
        status: "Available",
        resident_id: null,
      }),
    /occupied resident room/,
  );
});
