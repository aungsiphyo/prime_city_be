const TOOL_INTENTS = new Set([
  "getParkingStatus",
  "getRecentParkingEvents",
  "getSOSAlerts",
  "getLatestRfidScans",
  "getMyRoom",
  "getMyBills",
  "getMyVisitors",
  "createMaintenanceRequest",
]);

function normalizeMessage(message) {
  return String(message || "").toLowerCase().trim();
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function classifyIntent(message) {
  const text = normalizeMessage(message);
  const compact = text.replace(/[!?.\s]+/g, " ").trim();

  if (!text) {
    return { name: "generalChat", confidence: 0, toolName: null };
  }

  if (
    compact === "sos" ||
    compact === "emergency" ||
    compact === "help" ||
    hasAny(text, ["အရေးပေါ်", "ကယ်ပါ", "မီးလောင်", "ဆေးရုံ", "ambulance"])
  ) {
    return { name: "emergency", confidence: 1, toolName: null };
  }

  const asksRule = hasAny(text, [
    "rule",
    "rules",
    "policy",
    "faq",
    "manual",
    "guide",
    "how to",
    "ဘယ်လို",
    "စည်းမျဉ်း",
    "စည်းကမ်း",
    "လမ်းညွှန်",
    "နည်းလမ်း",
    "အသုံးပြု",
  ]);

  if (asksRule) {
    return { name: "ragSearch", confidence: 0.9, toolName: null };
  }

  if (
    hasAny(text, ["parking", "slot", "available", "ပါကင်", "ကားရပ်"]) &&
    hasAny(text, ["latest", "recent", "history", "event", "change", "ပြောင်း", "နောက်ဆုံး"])
  ) {
    return {
      name: "getRecentParkingEvents",
      confidence: 0.9,
      toolName: "getRecentParkingEvents",
      args: {
        type: hasAny(text, ["visitor", "ဧည့်", "ဧည့်"]) ? "visitor" : hasAny(text, ["resident", "နေထိုင်"]) ? "resident" : undefined,
      },
    };
  }

  if (
    hasAny(text, ["parking", "slot", "available", "ပါကင်", "ကားရပ်"]) &&
    hasAny(text, ["ကျန်", "status", "available", "ဘယ်လောက်", "ရှိ"])
  ) {
    return {
      name: "getParkingStatus",
      confidence: 0.95,
      toolName: "getParkingStatus",
    };
  }

  if (
    hasAny(text, ["sos", "alert", "emergency", "အရေးပေါ်"]) &&
    hasAny(text, ["latest", "recent", "နောက်ဆုံး", "အသစ်", "စာရင်း", "ရှိ"])
  ) {
    return {
      name: "getSOSAlerts",
      confidence: 0.9,
      toolName: "getSOSAlerts",
    };
  }

  if (
    hasAny(text, ["rfid", "card", "scan", "ကတ်", "စကင်"]) &&
    hasAny(text, ["latest", "recent", "နောက်ဆုံး", "အသစ်", "စာရင်း", "ဝင်"])
  ) {
    return {
      name: "getLatestRfidScans",
      confidence: 0.9,
      toolName: "getLatestRfidScans",
    };
  }

  if (
    hasAny(text, ["bill", "bills", "invoice", "payment", "ကြေး", "ဘေလ်", "ငွေ"]) &&
    !asksRule
  ) {
    return { name: "getMyBills", confidence: 0.88, toolName: "getMyBills" };
  }

  if (
    hasAny(text, ["visitor", "guest", "ဧည့်", "ဧည့်", "visitor list"]) &&
    !asksRule
  ) {
    return {
      name: "getMyVisitors",
      confidence: 0.86,
      toolName: "getMyVisitors",
      args: {
        today: hasAny(text, ["today", "ဒီနေ့", "ယနေ့"]),
      },
    };
  }

  if (
    hasAny(text, ["room", "my room", "အခန်း"]) &&
    hasAny(text, ["info", "information", "status", "ပြ", "ဘာ", "ဘယ်"])
  ) {
    return { name: "getMyRoom", confidence: 0.9, toolName: "getMyRoom" };
  }

  if (
    hasAny(text, [
      "maintenance",
      "repair",
      "fix",
      "broken",
      "leak",
      "ပြင်",
      "ပြုပြင်",
      "ပျက်",
      "ယို",
      "မီး",
      "ရေ",
    ])
  ) {
    return {
      name: "createMaintenanceRequest",
      confidence: 0.84,
      toolName: "createMaintenanceRequest",
      args: buildMaintenanceArgs(message),
    };
  }

  return { name: "generalChat", confidence: 0.4, toolName: null };
}

function buildMaintenanceArgs(message) {
  const original = String(message || "").trim();
  const lower = original.toLowerCase();
  const genericTerms = [
    "maintenance request",
    "maintenance",
    "repair request",
    "request",
    "တင်ချင်",
    "တင်ပေး",
    "ပြင်ချင်",
  ];
  let detail = original;

  genericTerms.forEach((term) => {
    detail = detail.replace(new RegExp(term, "gi"), " ");
  });

  detail = detail.replace(/\s+/g, " ").trim();

  const hasUsefulDetail =
    detail.length >= 6 ||
    hasAny(lower, ["leak", "broken", "pipe", "water", "light", "door", "ရေ", "ယို", "မီး", "တံခါး", "ပိုက်"]);

  return {
    title: hasUsefulDetail ? original.slice(0, 80) : "",
    description: hasUsefulDetail ? original : "",
    hasUsefulDetail,
  };
}

function isToolIntent(intent) {
  return TOOL_INTENTS.has(intent?.name);
}

module.exports = {
  classifyIntent,
  isToolIntent,
};
