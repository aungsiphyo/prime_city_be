const COMPONENT_FIELDS = Object.freeze([
  "electricity_amount",
  "water_amount",
  "installment_amount",
  "maintenance_amount",
  "service_amount",
  "other_amount",
]);

const ACTIVE_PAYMENT_STATUSES = new Set(["Pending", "Under Review"]);

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100) / 100;
}

function calculateBillTotal(source = {}) {
  return COMPONENT_FIELDS.reduce((total, field) => {
    const value = normalizeMoney(source[field]);
    if (value === null) throw new Error(`${field} must be a non-negative number`);
    return Math.round((total + value) * 100) / 100;
  }, 0);
}

function hasComponentAmounts(source = {}) {
  return COMPONENT_FIELDS.some((field) => Number(source[field] || 0) > 0);
}

function buildBillingKey(roomId, billingYear, billingMonth) {
  const year = Number(billingYear);
  const month = Number(billingMonth);

  if (!roomId || !Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return null;

  return `${String(roomId)}:${year}-${String(month).padStart(2, "0")}`;
}

function amountsMatch(expected, submitted) {
  const normalizedExpected = normalizeMoney(expected);
  const normalizedSubmitted = normalizeMoney(submitted);
  return (
    normalizedExpected !== null &&
    normalizedSubmitted !== null &&
    normalizedExpected === normalizedSubmitted
  );
}

function canSubmitPaymentForBill(status) {
  return ["Pending", "Overdue", "Rejected", "Pending Verification"].includes(
    String(status || "Pending"),
  );
}

function isActivePaymentStatus(status) {
  return ACTIVE_PAYMENT_STATUSES.has(String(status || ""));
}

module.exports = {
  ACTIVE_PAYMENT_STATUSES,
  COMPONENT_FIELDS,
  amountsMatch,
  buildBillingKey,
  calculateBillTotal,
  canSubmitPaymentForBill,
  hasComponentAmounts,
  isActivePaymentStatus,
  normalizeMoney,
};
