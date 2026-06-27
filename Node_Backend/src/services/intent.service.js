const TOOL_INTENTS = new Set([
  "getMyProfile",
  "getParkingStatus",
  "getRecentParkingEvents",
  "getSOSAlerts",
  "getLatestRfidScans",
  "getMyRoom",
  "getMyBills",
  "getMyVisitors",
  "createMaintenanceRequest",
  "getHelpers",
  "createHelperRequest",
  "getAnnouncements",
  "getResidentAccessInfo",
]);

function normalizeMessage(message) {
  return String(message || "").toLowerCase().trim();
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function buildBillArgs(message) {
  const text = normalizeMessage(message);
  const args = {};
  const now = new Date();
  const yearMatch = String(message || "").match(/\b(19\d{2}|20\d{2})\b/);
  const monthNames = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12,
  };

  args.year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
  args.month = now.getMonth() + 1;

  for (const [name, month] of Object.entries(monthNames)) {
    if (text.includes(name)) {
      args.month = month;
      break;
    }
  }

  if (hasAny(text, ["last month", "ပြီးခဲ့တဲ့လ", "ပြီးခဲ့သောလ"])) {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    args.year = lastMonth.getFullYear();
    args.month = lastMonth.getMonth() + 1;
  }

  if (hasAny(text, ["paid", "ပေးပြီး", "ရှင်းပြီး"])) args.status = "Paid";
  if (hasAny(text, ["overdue", "နောက်ကျ", "ကျော်"])) args.status = "Overdue";
  if (hasAny(text, ["pending", "unpaid", "မပေး", "မရှင်း"])) args.status = "Pending";

  return args;
}

function buildHelperRequestArgs(message) {
  const original = String(message || "").trim();
  const text = normalizeMessage(message);
  let type = "House Helper";

  if (hasAny(text, ["clean", "cleaning", "သန့်ရှင်း", "သန့်ရှင်း"])) {
    type = "Cleaning";
  } else if (hasAny(text, ["laundry", "လျှော်", "အဝတ်"])) {
    type = "Laundry";
  } else if (hasAny(text, ["cook", "cooking", "ချက်ပြုတ်", "ထမင်း"])) {
    type = "Cooking";
  }

  return {
    type,
    gender_preferred: hasAny(text, ["female", "အမျိုးသမီး", "မိန်းကလေး"])
      ? "Female"
      : hasAny(text, ["male", "အမျိုးသား", "ယောက်ျား"])
        ? "Male"
        : "No Preference",
    note: original,
  };
}

function classifyIntent(message) {
  const text = normalizeMessage(message);
  const compact = text.replace(/[!?.\s]+/g, " ").trim();
  const compactText = text.replace(/\s+/g, "");

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

  if (
    hasAny(text, [
      "what is my name",
      "what's my name",
      "who am i",
      "ငါ့နာမည်",
      "ကျွန်တော့်နာမည်",
      "ကျွန်မနာမည်",
      "ကျွန်ုပ်နာမည်",
    ])
  ) {
    return {
      name: "getMyProfile",
      confidence: 1,
      toolName: "getMyProfile",
      args: { field: "name" },
    };
  }

  if (
    hasAny(text, [
      "my email",
      "my phone",
      "my resident id",
      "my user id",
      "my profile",
      "my account",
      "my data",
      "personal information",
      "account information",
      "ငါ့အီးမေးလ်",
      "ငါ့ဖုန်း",
      "ကျွန်တော့်ဖုန်း",
      "ကျွန်မဖုန်း",
      "ကိုယ်ရေးအချက်အလက်",
      "ငါ့အချက်အလက်",
      "ကျွန်တော့်အချက်အလက်",
      "ကျွန်မအချက်အလက်",
      "ပရိုဖိုင်",
    ])
  ) {
    return {
      name: "getMyProfile",
      confidence: 1,
      toolName: "getMyProfile",
      args: { field: "profile" },
    };
  }

  if (
    hasAny(text, ["access", "permission", "permissions", "right", "rights", "ရပိုင်", "ခွင့်", "ခွင့်"]) &&
    hasAny(text, ["resident", "citizen", "user", "နေထိုင်", "သုံး", "မေး"])
  ) {
    return {
      name: "getResidentAccessInfo",
      confidence: 0.94,
      toolName: "getResidentAccessInfo",
    };
  }

  if (
    (hasAny(text, ["announcement", "announcements", "notice", "notification", "အသိပေး", "ကြေညာ", "အကြောင်းကြား"]) ||
      hasAny(compactText, ["အကြောင်းကြား", "အကြောင်းကြားစာ"])) &&
    hasAny(text, ["latest", "recent", "list", "စာရင်း", "နောက်ဆုံး", "အသစ်", "ရှိ", "ပြ", "ဘာ"])
  ) {
    return {
      name: "getAnnouncements",
      confidence: 0.92,
      toolName: "getAnnouncements",
    };
  }

  const asksHelper =
    hasAny(text, [
      "helper",
      "house helper",
      "maid",
      "cleaner",
      "အိမ်အကူ",
      "အိမ္အကူ",
      "အကူ",
    ]) || hasAny(compactText, ["အိမ်အကူ", "အိမ္အကူ"]);

  if (
    asksHelper &&
    hasAny(text, ["request", "တောင်း", "တောင်းခံ", "ခေါ်", "လိုချင်", "ယူ", "တင်"])
  ) {
    return {
      name: "createHelperRequest",
      confidence: 0.9,
      toolName: "createHelperRequest",
      args: buildHelperRequestArgs(message),
    };
  }

  if (
    asksHelper &&
    hasAny(text, ["list", "စာရင်း", "ကြည့်", "ကြည့်", "ပြ", "ရှိ", "available"])
  ) {
    return {
      name: "getHelpers",
      confidence: 0.88,
      toolName: "getHelpers",
    };
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
    return {
      name: "getMyBills",
      confidence: 0.88,
      toolName: "getMyBills",
      args: buildBillArgs(message),
    };
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
