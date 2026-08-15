const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCategoryBillsForRoom,
} = require("../src/services/billCategory.service");

test("each non-zero fee becomes an independently payable category bill", () => {
  const room = {
    _id: "room-a",
    room_type: "Standard",
    status: "Occupied",
    resident_id: "resident-a",
    installments_paid: 0,
    installment_status: "Active",
  };
  const bills = buildCategoryBillsForRoom(
    {
      billing_month: 8,
      billing_year: 2026,
      electricity_amount: 25_000,
      water_amount: 8_000,
      maintenance_amount: 0,
      service_amount: 1_000,
      other_amount: 0,
      category_due_dates: {
        installment_amount: "2026-08-20T12:00:00.000Z",
        electricity_amount: "2026-08-22T12:00:00.000Z",
        water_amount: "2026-08-24T12:00:00.000Z",
        service_amount: "2026-08-26T12:00:00.000Z",
      },
    },
    room,
    { now: new Date("2026-08-15T12:00:00.000Z") },
  );

  assert.deepEqual(
    bills.map((bill) => bill.category),
    ["Apartment Installment", "Electricity", "Water", "Service Fee"],
  );
  assert.deepEqual(
    bills.map((bill) => bill.amount),
    [2_000_000, 25_000, 8_000, 1_000],
  );
  assert.equal(new Set(bills.map((bill) => bill.billing_key)).size, 4);
  assert.equal(new Set(bills.map((bill) => bill.due_date.toISOString())).size, 4);
  bills.forEach((bill) => {
    const nonZeroComponents = [
      bill.electricity_amount,
      bill.water_amount,
      bill.installment_amount,
      bill.maintenance_amount,
      bill.service_amount,
      bill.other_amount,
    ].filter((amount) => amount > 0);
    assert.deepEqual(nonZeroComponents, [bill.amount]);
  });
});
