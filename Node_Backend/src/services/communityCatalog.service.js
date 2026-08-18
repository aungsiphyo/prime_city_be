const HELPER_CATEGORIES = [
  "House Helper",
  "Cleaning",
  "Cooking",
  "Laundry",
  "Elder Care",
  "Child Care",
  "Maintenance",
];

const HELPER_PRICING = Object.freeze({
  Cleaning: Object.freeze({
    amount_mmk: 30000,
    service_window: "9:00 AM - 12:00 PM",
  }),
});

const PLAYGROUND_TIME_SLOTS = Object.freeze([
  "Morning",
  "Afternoon",
  "Evening",
]);

function readNonNegativeNumber(name, fallback = 0) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getHelperCatalog() {
  return HELPER_CATEGORIES.map((name) => ({
    name,
    currency: "MMK",
    amount_mmk: HELPER_PRICING[name]?.amount_mmk ?? null,
    service_window: HELPER_PRICING[name]?.service_window ?? null,
    pricing_status: HELPER_PRICING[name] ? "Fixed" : "Admin Confirmation",
  }));
}

function getHelperPriceSnapshot(category) {
  const entry = getHelperCatalog().find((item) => item.name === category);
  if (!entry) return null;

  return {
    quoted_price_mmk: entry.amount_mmk,
    quoted_currency: entry.currency,
    service_window: entry.service_window,
    pricing_status: entry.pricing_status,
  };
}

function getPlaygroundConfig() {
  const pricingConfigured =
    process.env.PLAYGROUND_BASE_FEE_MMK != null &&
    String(process.env.PLAYGROUND_BASE_FEE_MMK).trim() !== "";
  const baseFeeMmk = readNonNegativeNumber("PLAYGROUND_BASE_FEE_MMK", 0);
  const discountPercent = Math.min(
    100,
    readNonNegativeNumber("PLAYGROUND_RESIDENT_DISCOUNT_PERCENT", 0),
  );
  const discountedFeeMmk = Math.round(
    baseFeeMmk * (1 - discountPercent / 100),
  );

  return {
    currency: "MMK",
    base_fee_mmk: baseFeeMmk,
    resident_discount_percent: discountPercent,
    discounted_fee_mmk: discountedFeeMmk,
    pricing_configured: pricingConfigured,
    discount_configured: discountPercent > 0,
    time_slots: [...PLAYGROUND_TIME_SLOTS],
  };
}

module.exports = {
  HELPER_CATEGORIES,
  PLAYGROUND_TIME_SLOTS,
  getHelperCatalog,
  getHelperPriceSnapshot,
  getPlaygroundConfig,
};
