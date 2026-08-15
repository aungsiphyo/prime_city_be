const {
  COMPONENT_FIELDS,
  buildBillingKey,
  normalizeMoney,
} = require("./billing.service");
const { getMonthlyInstallment } = require("./propertyFinance.service");

const DEFAULT_PAYMENT_WINDOW_DAYS = 7;

const BILL_CATEGORY_CONFIGS = Object.freeze([
  Object.freeze({
    category: "Apartment Installment",
    field: "installment_amount",
    type: "Installment",
  }),
  Object.freeze({
    category: "Electricity",
    field: "electricity_amount",
    type: "Electricity",
  }),
  Object.freeze({ category: "Water", field: "water_amount", type: "Water" }),
  Object.freeze({
    category: "Maintenance",
    field: "maintenance_amount",
    type: "Maintenance",
  }),
  Object.freeze({
    category: "Service Fee",
    field: "service_amount",
    type: "Service",
  }),
  Object.freeze({ category: "Other", field: "other_amount", type: "Other" }),
]);

function getCategoryConfig(value) {
  return BILL_CATEGORY_CONFIGS.find(
    (config) =>
      config.category === value ||
      config.field === value ||
      config.type === value,
  );
}

function parseBillingPeriod(body = {}) {
  const month = Number(body.billing_month);
  const year = Number(body.billing_year);
  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2200
  ) {
    const error = new Error("billing_month and billing_year are invalid");
    error.status = 400;
    throw error;
  }
  return { month, year };
}

function parseCategoryDueDate(value, now) {
  if (!value) {
    return new Date(
      now.getTime() + DEFAULT_PAYMENT_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
    );
  }

  const text = String(value).trim();
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T23:59:59+06:30`)
    : new Date(text);
  if (Number.isNaN(dueDate.getTime())) {
    const error = new Error("Every selected category must have a valid due date");
    error.status = 400;
    throw error;
  }
  return dueDate;
}

function getCategoryDueDate(body, config, now) {
  const dueDates = body.category_due_dates || {};
  return parseCategoryDueDate(
    dueDates[config.field] ||
      dueDates[config.category] ||
      dueDates[config.type] ||
      body.due_date,
    now,
  );
}

function buildCategoryWarning(config, dueDate) {
  const formattedDate = dueDate.toLocaleDateString("en-GB");
  if (["Electricity", "Water"].includes(config.category)) {
    return `${config.category} must be paid by ${formattedDate}. The related service may be suspended after the due date while this category remains unpaid.`;
  }
  return `${config.category} must be paid by ${formattedDate}. This category can be paid separately from the resident's other bills.`;
}

function buildCategoryBillPayload({
  room,
  config,
  amount,
  month,
  year,
  dueDate,
  customTitle,
  otherDescription,
  createdBy,
  now,
}) {
  const componentAmounts = Object.fromEntries(
    COMPONENT_FIELDS.map((field) => [field, field === config.field ? amount : 0]),
  );
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  const paymentWindowDays = Math.max(
    1,
    Math.min(365, Math.ceil((dueDate.getTime() - now.getTime()) / 86_400_000)),
  );

  return {
    room_id: room._id,
    resident_user_id: room.resident_id || null,
    title: customTitle
      ? `${customTitle} — ${config.category}`
      : `${monthName} ${year} ${config.category}`,
    type: config.type,
    category: config.category,
    billing_month: month,
    billing_year: year,
    billing_key: buildBillingKey(room._id, year, month, config.category),
    ...componentAmounts,
    other_description:
      config.category === "Other" ? String(otherDescription || "").trim() : "",
    payment_window_days: paymentWindowDays,
    service_cutoff_warning: buildCategoryWarning(config, dueDate),
    installment_applied: false,
    amount,
    status: "Pending",
    due_date: dueDate,
    created_by: createdBy || null,
    created_at: now,
    updated_at: now,
  };
}

function buildCategoryBillsForRoom(body, room, options = {}) {
  if (!room?._id || room.status !== "Occupied" || !room?.resident_id) {
    const error = new Error("An occupied resident room is required");
    error.status = 400;
    throw error;
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const { month, year } = parseBillingPeriod(body);
  const values = { ...body };
  values.installment_amount =
    body.include_installment === false ? 0 : getMonthlyInstallment(room);

  const bills = [];
  for (const config of BILL_CATEGORY_CONFIGS) {
    const amount = normalizeMoney(values[config.field]);
    if (amount === null) {
      const error = new Error(`${config.field} must be a non-negative number`);
      error.status = 400;
      throw error;
    }
    if (!(amount > 0)) continue;

    bills.push(
      buildCategoryBillPayload({
        room,
        config,
        amount,
        month,
        year,
        dueDate: getCategoryDueDate(body, config, now),
        customTitle: String(body.title || "").trim(),
        otherDescription: body.other_description,
        createdBy: options.createdBy,
        now,
      }),
    );
  }

  if (!bills.length) {
    const error = new Error("At least one bill category must be greater than zero");
    error.status = 400;
    throw error;
  }
  return bills;
}

module.exports = {
  BILL_CATEGORY_CONFIGS,
  DEFAULT_PAYMENT_WINDOW_DAYS,
  buildCategoryBillPayload,
  buildCategoryBillsForRoom,
  getCategoryConfig,
  parseBillingPeriod,
};
