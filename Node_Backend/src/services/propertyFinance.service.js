const ROOM_PRICES = Object.freeze({
  Business: 500_000_000,
  Office: 1_000_000_000,
  Standard: 200_000_000,
  Premium: 300_000_000,
});

const DOWN_PAYMENT_PERCENT = 40;
const INSTALLMENT_MONTHS = 60;

function calculatePropertyFinance(roomType) {
  const purchasePrice = ROOM_PRICES[roomType];
  if (!purchasePrice) throw new Error(`Unsupported room type: ${roomType}`);

  const downPaymentAmount = Math.round(
    purchasePrice * (DOWN_PAYMENT_PERCENT / 100),
  );
  const financedAmount = purchasePrice - downPaymentAmount;
  const monthlyInstallmentAmount = Math.round(
    (financedAmount / INSTALLMENT_MONTHS) * 100,
  ) / 100;

  return {
    purchase_price: purchasePrice,
    down_payment_percent: DOWN_PAYMENT_PERCENT,
    down_payment_amount: downPaymentAmount,
    financed_amount: financedAmount,
    installment_months: INSTALLMENT_MONTHS,
    monthly_installment_amount: monthlyInstallmentAmount,
  };
}

function addMonths(value, months) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const next = new Date(date);
  next.setMonth(next.getMonth() + Number(months || 0));
  return next;
}

function buildRoomFinanceFields(roomType, source = {}) {
  const finance = calculatePropertyFinance(roomType);
  const installmentStartDate = source.installment_start_date
    ? new Date(source.installment_start_date)
    : source.purchase_date
      ? new Date(source.purchase_date)
      : new Date();
  const paidMonths = Math.min(
    finance.installment_months,
    Math.max(0, Number(source.installments_paid || 0)),
  );
  const remaining = Math.max(
    0,
    finance.financed_amount - paidMonths * finance.monthly_installment_amount,
  );

  return {
    ...finance,
    purchase_date: source.purchase_date
      ? new Date(source.purchase_date)
      : installmentStartDate,
    down_payment_status: "Paid",
    down_payment_paid_at: source.down_payment_paid_at
      ? new Date(source.down_payment_paid_at)
      : installmentStartDate,
    installment_start_date: installmentStartDate,
    installment_end_date: addMonths(
      installmentStartDate,
      finance.installment_months,
    ),
    installments_paid: paidMonths,
    installment_remaining_amount: remaining,
    installment_status:
      paidMonths >= finance.installment_months ? "Paid" : "Active",
  };
}

function getMonthlyInstallment(room = {}) {
  if (room.installment_status === "Paid") return 0;
  if (Number(room.installments_paid || 0) >= INSTALLMENT_MONTHS) return 0;

  const configured = Number(room.monthly_installment_amount);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return calculatePropertyFinance(room.room_type).monthly_installment_amount;
}

module.exports = {
  DOWN_PAYMENT_PERCENT,
  INSTALLMENT_MONTHS,
  ROOM_PRICES,
  addMonths,
  buildRoomFinanceFields,
  calculatePropertyFinance,
  getMonthlyInstallment,
};
