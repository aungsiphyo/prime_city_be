const crypto = require("crypto");
const { getToolSchemas } = require("./toolRegistry");
const { runTool } = require("./aiTools.service");
const { retrieveKnowledge, buildRagContext } = require("./rag.service");
const { classifyIntent, isToolIntent } = require("./intent.service");
const { GoogleGenAI } = require("@google/genai");

function numberEnv(name, fallback, { min = Number.NEGATIVE_INFINITY } = {}) {
  const value = Number(process.env[name]);

  if (Number.isFinite(value) && value >= min) return value;

  return fallback;
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const GEMINI_TEMPERATURE = numberEnv("GEMINI_TEMPERATURE", 0.3, { min: 0 });
const AI_HISTORY_LIMIT = numberEnv("AI_HISTORY_LIMIT", 8, { min: 0 });

const SYSTEM_PROMPT =
  process.env.AI_SYSTEM_PROMPT ||
  `
You are SmartRes AI, a helpful assistant for a smart residential community.

Rules:
- Reply in Myanmar language unless the user uses English.
- When replying in Myanmar, use Myanmar Unicode script only. Do not use romanized Burmese unless the user explicitly asks for romanization.
- You can help with parking, rooms, bills, visitors, SOS, announcements, notifications, house helpers, helper requests, and community services.
- You understand intents such as parking status, room info, bills, monthly bill totals, visitors, helper lists, helper requests, maintenance requests, resident access permissions, notices, RAG policy search, SOS, and general chat.
- Never expose private data.
- Use database/tool data only when provided.
- Never guess real-time database values such as parking slots, room data, bills, visitors, or maintenance request status.
- Use knowledge base context when it is provided and relevant.
- For community rules, fees, policies, manuals, and notices, do not invent facts.
- If data is missing, say you cannot find it.
- For SOS or emergency messages, give calm immediate safety guidance. Do not claim an alert was sent unless backend data confirms it.
- If the user context includes a name, address the user by that name naturally (e.g. “ကိုဖြိုး”, “မဆု”) when it feels appropriate, without overusing it.
`;

const RESPONSE_STYLE_PROMPT =
  process.env.AI_RESPONSE_STYLE_PROMPT ||
  "Give the final answer only. Keep replies concise: 1 to 4 short sentences unless the user asks for details.";

function createMessage(role, content, extras = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

/**
 * Builds a concise user-context string for injection into the system prompt.
 * Lets the AI know who it is talking to for personalized, faster responses.
 */
function buildUserContext(user) {
  if (!user) return null;

  const name = (user.fullname || user.name || "").trim();
  const role = (user.role || "Citizen").trim();
  const room = String(user.room_id || user.roomNumber || "").trim();
  const details = [`User role: ${role}.`];

  if (name) details.unshift(`Current user name: ${name}.`);
  if (room) details.push(`Linked room reference: ${room}.`);

  details.push(
    "This identity belongs to the authenticated user only. Never infer or expose another user's data.",
  );
  if (name) details.push("Address the user by name when it feels natural.");

  return details.join(" ");
}

function ensureConversationId(conversationId) {
  return conversationId || `conv-${crypto.randomUUID()}`;
}

function normalizeHistoryForGemini(history) {
  if (!Array.isArray(history)) return [];
  if (AI_HISTORY_LIMIT === 0) return [];

  return history
    .filter(
      (entry) =>
        entry && typeof entry.content === "string" && entry.content.trim(),
    )
    .slice(-AI_HISTORY_LIMIT)
    .map((entry) => ({
      role: entry.role === "assistant" ? "model" : "user",
      parts: [{ text: entry.content.trim() }],
    }));
}

function isToolQuestion(message) {
  const text = message.toLowerCase();

  return (
    text.includes("parking") ||
    text.includes("slot") ||
    text.includes("ပါကင်") ||
    text.includes("ကားရပ်") ||
    text.includes("room") ||
    text.includes("အခန်း") ||
    text.includes("bill") ||
    text.includes("ဘေလ်") ||
    text.includes("helper") ||
    text.includes("အိမ်အကူ") ||
    text.includes("announcement") ||
    text.includes("notice") ||
    text.includes("notification") ||
    text.includes("အသိပေး") ||
    text.includes("ကြေညာ") ||
    text.includes("access") ||
    text.includes("permission")
  );
}

function shouldEnableTools(message) {
  return process.env.AI_ENABLE_TOOLS === "true" && isToolQuestion(message);
}

function isEmergencyMessage(message) {
  const text = message.toLowerCase().trim();
  const compact = text.replace(/[!?.\s]+/g, " ").trim();

  return (
    compact === "sos" ||
    compact === "emergency" ||
    compact === "help" ||
    text.includes("အရေးပေါ်") ||
    text.includes("ကယ်ပါ")
  );
}

function buildEmergencyResponse() {
  return (
    "SOS request ကိုတွေ့ပါတယ်။ အရေးပေါ်အန္တရာယ်ရှိနေရင် " +
    "လုံခြုံရေး/management ကို ချက်ချင်းဖုန်းဆက်ပါ၊ လိုအပ်ရင် ဒေသဆိုင်ရာ emergency service ကို ဆက်သွယ်ပါ။ " +
    "ဒီ chat က alert ပို့ပြီးသားလို့ မယူဆပါနဲ့။ App ထဲမှာ SOS action ရှိရင် အဲ့ဒါကိုလည်း ချက်ချင်းနှိပ်ပါ။"
  );
}

function formatDate(value) {
  if (!value) return "မသတ်မှတ်ထားပါ";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "မသတ်မှတ်ထားပါ";

  return date.toISOString().slice(0, 10);
}

function formatAmount(value) {
  const amount = Number(value || 0);

  return amount.toLocaleString("en-US");
}

function buildToolAssistantContent(toolName, result) {
  if (toolName === "getMyProfile") {
    if (!result.found) {
      return "သင့်အကောင့်အချက်အလက် မတွေ့သေးပါ။ ပြန်လည်ဝင်ရောက်ပြီး စမ်းကြည့်ပါ။";
    }

    if (result.requestedField === "name") {
      return `သင့်အမည်က ${result.name} ဖြစ်ပါတယ်။`;
    }

    const roomText = result.roomNumber
      ? `အခန်း ${result.roomNumber}`
      : "ချိတ်ဆက်ထားသောအခန်း မရှိသေးပါ";
    const residentText = result.residentUid
      ? `၊ Resident ID ${result.residentUid}`
      : "";

    return (
      `သင့်အမည်က ${result.name} ဖြစ်ပါတယ်။ ` +
      `အကောင့်အမျိုးအစား ${result.role}၊ ${roomText}${residentText} ဖြစ်ပါတယ်။ ` +
      `Email ${result.email}၊ ဖုန်း ${result.phone} ပါ။`
    );
  }

  if (toolName === "getParkingStatus") {
    return (
      `Visitor parking slot ${result.visitor.availableSlot} ခုကျန်ပါတယ်။ ` +
      `Resident parking slot ${result.resident.availableSlot} ခုကျန်ပါတယ်။`
    );
  }

  if (toolName === "getRecentParkingEvents") {
    if (!result.events.length) {
      return "Parking ပြောင်းလဲမှု history မတွေ့သေးပါ။";
    }

    const latest = result.events[0];
    const action = latest.delta > 0 ? "ဝင်ထား" : "ထွက်ထား";
    return (
      `နောက်ဆုံး parking change က ${latest.type} parking မှာ ${action}တာပါ။ ` +
      `လက်ရှိ used ${latest.usedSlot}, available ${latest.availableSlot} ဖြစ်ပါတယ်။`
    );
  }

  if (toolName === "getSOSAlerts") {
    if (!result.alerts.length) {
      return "နောက်ဆုံး SOS alert မတွေ့သေးပါ။";
    }

    const latest = result.alerts[0];
    return (
      `နောက်ဆုံး SOS alert က ${latest.message || "message မရှိ"} ဖြစ်ပါတယ်။ ` +
      `Status ${latest.status}, priority ${latest.priority}, source ${latest.source || "မသိ"} ပါ။`
    );
  }

  if (toolName === "getLatestRfidScans") {
    if (!result.scans.length) {
      return "နောက်ဆုံး RFID scan မတွေ့သေးပါ။";
    }

    const latest = result.scans[0];
    const name = latest.residentName || latest.visitorName || "မတွေ့";
    const validText = latest.valid ? "valid" : "invalid";
    return (
      `နောက်ဆုံး RFID scan က ${validText} ဖြစ်ပါတယ်။ ` +
      `UID ${latest.hardwareUid || "မရှိ"}, person ${name}, room ${latest.roomName || "-"} ပါ။`
    );
  }

  if (toolName === "getMyRoom") {
    if (!result.found) {
      return `သင့် room information မတွေ့သေးပါ။ ${result.message || "Login/room link ကိုစစ်ပါ။"}`;
    }

    return (
      `သင့်အခန်းက ${result.roomNumber} ဖြစ်ပါတယ်။ ` +
      `အခန်းပိုင်ရှင်/Resident: ${result.ownerName || "မသတ်မှတ်ထားပါ"}။ ` +
      `Floor ${result.floor}, type ${result.roomType}, status ${result.status} ဖြစ်ပါတယ်။`
    );
  }

  if (toolName === "getMyBills") {
    if (!result.found) {
      return `သင့် bill data မတွေ့သေးပါ။ ${result.message || "Login/room link ကိုစစ်ပါ။"}`;
    }

    const summary = result.monthlySummary;

    if (!result.bills.length && !summary?.count) {
      return `အခန်း ${result.roomNumber} အတွက် bill data မတွေ့ပါ။`;
    }

    if (summary) {
      const latest = result.bills[0];
      const latestText = latest
        ? ` နောက်ဆုံး bill က ${formatAmount(latest.amount)} (${latest.status}), due date ${formatDate(latest.dueDate)} ပါ။`
        : "";

      if (!summary.count) {
        return (
          `အခန်း ${result.roomNumber} အတွက် ${summary.label} လ bill မတွေ့ပါ။ ` +
          `မရှင်းရသေးတဲ့စုစုပေါင်းက ${formatAmount(result.totalOutstanding)} ဖြစ်ပါတယ်။` +
          latestText
        );
      }

      return (
        `အခန်း ${result.roomNumber} အတွက် ${summary.label} လ bill စုစုပေါင်း ${formatAmount(summary.totalAmount)} ဖြစ်ပါတယ်။ ` +
        `မရှင်းရသေးတာ ${formatAmount(summary.unpaidAmount)}, ပေးပြီးတာ ${formatAmount(summary.paidAmount)} ပါ။ ` +
        `လက်ရှိ unpaid total အကုန်ပေါင်း ${formatAmount(result.totalOutstanding)} ဖြစ်ပါတယ်။` +
        latestText
      );
    }

    const latest = result.bills[0];
    return (
      `အခန်း ${result.roomNumber} အတွက် မပေးရသေးတဲ့စုစုပေါင်း ${result.totalOutstanding} ဖြစ်ပါတယ်။ ` +
      `နောက်ဆုံး bill က ${latest.amount} (${latest.status}), due date ${formatDate(latest.dueDate)} ပါ။`
    );
  }

  if (toolName === "getMyVisitors") {
    if (!result.found) {
      return `သင့် visitor data မတွေ့သေးပါ။ ${result.message || "Login/room link ကိုစစ်ပါ။"}`;
    }

    if (!result.visitors.length) {
      return `အခန်း ${result.roomNumber} အတွက် recent visitor မတွေ့ပါ။`;
    }

    const latest = result.visitors[0];
    return (
      `အခန်း ${result.roomNumber} အတွက် recent visitor ${result.visitors.length} ယောက်တွေ့ပါတယ်။ ` +
      `နောက်ဆုံး visitor က ${latest.name || "အမည်မရှိ"} (${latest.purpose || "General"}), badge ${latest.badgeNumber || "မရှိ"} ပါ။`
    );
  }

  if (toolName === "createMaintenanceRequest") {
    if (result.created) {
      return (
        `Maintenance request တင်ပြီးပါပြီ။ ` +
        `Room ${result.roomNumber}, status ${result.status}, request ID ${result.reportId} ဖြစ်ပါတယ်။`
      );
    }

    if (result.needsFollowUp) {
      return `Maintenance request တင်ဖို့ ပြဿနာအသေးစိတ်ပြောပါ။ ဥပမာ ရေပိုက်ယိုတာ၊ မီးမလာတာ၊ တံခါးပျက်တာလို detail လိုပါတယ်။`;
    }

    return `Maintenance request မတင်နိုင်သေးပါ။ ${result.message || "Login/room link ကိုစစ်ပါ။"}`;
  }

  if (toolName === "getHelpers") {
    if (!result.helpers.length) {
      return "လက်ရှိ Active ဖြစ်နေတဲ့ အိမ်အကူစာရင်း မတွေ့သေးပါ။";
    }

    const helperList = result.helpers
      .slice(0, 5)
      .map((helper, index) => {
        const experience = Number(helper.experience || 0);
        const expText = experience ? `, experience ${experience} နှစ်` : "";
        const genderText = helper.gender ? `, ${helper.gender}` : "";
        return `${index + 1}. ${helper.name}${genderText}${expText}`;
      })
      .join(" ");

    return `အိမ်အကူ ${result.count} ယောက်တွေ့ပါတယ်။ ${helperList}`;
  }

  if (toolName === "createHelperRequest") {
    if (result.created) {
      return (
        `အိမ်အကူ request တင်ပြီးပါပြီ။ ` +
        `Room ${result.roomNumber}, type ${result.type}, preference ${result.genderPreferred}, status ${result.status}, request ID ${result.requestId} ဖြစ်ပါတယ်။`
      );
    }

    return `အိမ်အကူ request မတင်နိုင်သေးပါ။ ${result.message || "Login/room link ကိုစစ်ပါ။"}`;
  }

  if (toolName === "getAnnouncements") {
    if (!result.announcements.length && !result.notifications.length) {
      return "လက်ရှိ announcement/notification မတွေ့သေးပါ။";
    }

    const latestAnnouncement = result.announcements[0];
    const latestNotification = result.notifications[0];
    const parts = [];

    if (latestAnnouncement) {
      parts.push(
        `နောက်ဆုံး announcement က "${latestAnnouncement.title}" ဖြစ်ပြီး ${latestAnnouncement.message}`,
      );
    }

    if (latestNotification) {
      parts.push(
        `သင့် notification နောက်ဆုံးတစ်ခုက "${latestNotification.title}" ဖြစ်ပါတယ်။ ${latestNotification.message}`,
      );
    }

    return parts.join(" ");
  }

  if (toolName === "getResidentAccessInfo") {
    const permissions = result.permissions
      .slice(0, 8)
      .map((permission, index) => `${index + 1}. ${permission}`)
      .join(" ");

    return (
      `Resident/User အနေနဲ့ မေးလို့ရတဲ့ အဓိကအချက်တွေက ${permissions} ဖြစ်ပါတယ်။ ` +
      "ကိုယ်ပိုင် room/account data တွေက login user နဲ့ချိတ်ထားတဲ့ data ကိုပဲပြပါတယ်။"
    );
  }

  if (toolName === "registerVisitor") {
    if (result.needsFollowUp) {
      const missing = (result.missingFields || []).join(", ");
      return `ဧည့်သည်မှတ်ပုံတင်ရန် ${missing} ပြောပါ။`;
    }

    if (result.registered) {
      return (
        `ဧည့်သည် ${result.name} ကို အောင်မြင်စွာ မှတ်ပုံတင်ပြီးပါပြီ။ ` +
        `Badge ${result.badgeNumber}, UID ${result.visitorUid} ပါ။ ` +
        `Security gate ကိုလည်း အကြောင်းကြားသွားပါပြီ။`
      );
    }

    return `ဧည့်သည်မှတ်ပုံတင်မရသေးပါ။ ${result.message || "ပြန်လည်ကြိုးစားပါ။"}`;
  }

  if (toolName === "reserveVisitorParking") {
    if (result.needsFollowUp) {
      const missing = (result.missingFields || []).join(", ");
      return `ပါကင်ကြိုတင်ထားရန် ${missing} ပြောပါ။`;
    }

    if (!result.reserved) {
      return `ဝမ်းနည်းပါတယ်၊ ${result.message || "ပါကင် slot မရရှိနိုင်သေးပါ။"}`;
    }

    return (
      `ဧည့်သည်ပါကင် request တင်ပြီးပါပြီ။ ` +
      `ကား ${result.vehicleNumber}, ရက် ${result.date}, ${result.durationHours} နာရီ ပါ။ ` +
      `Admin မှ slot အတည်ပြုပေးပါမည်။`
    );
  }

  if (toolName === "reportLostCard") {
    if (result.requiresConfirmation) {
      return (
        "သင့် RFID ကတ်ကို ပိတ်မည်ဖြစ်ပါတယ်။ " +
        "ဤလုပ်ဆောင်ချက်သည် ကတ်ကို ထာဝစဉ် ပိတ်ပင်သွားမည်ဖြစ်သည်။\n" +
        "ဆက်လက်လုပ်ဆောင်ရန် CONFIRM လို့ရိုက်ထည့်ပေးပါ"
      );
    }

    if (result.deactivated) {
      return (
        `သင့် RFID ကတ် (UID: ${result.previousUid || "N/A"}) ကို ပိတ်ပင်ပြီးပါပြီ။ ` +
        `Admin ကို အကြောင်းကြားပြီးပါပြီ။ ကတ်အသစ် request တင်ရန် ပြောနိုင်ပါတယ်။`
      );
    }

    return `ကတ်ပိတ်မရနိုင်သေးပါ။ ${result.message || "ပြန်လည်ကြိုးစားပါ။"}`;
  }

  if (toolName === "requestReplacementCard") {
    if (result.requiresConfirmation) {
      return (
        "ကတ်အသစ် request တင်မည်ဖြစ်ပါတယ်။ " +
        "ဆက်လက်လုပ်ဆောင်ရန် CONFIRM လို့ရိုက်ထည့်ပေးပါ"
      );
    }

    if (result.requested) {
      return (
        `ကတ်အသစ် request (ID: ${result.requestId}) တင်ပြီးပါပြီ။ ` +
        `Admin မှ မကြာမီ ဆောင်ရွက်ပေးပါမည်။`
      );
    }

    return `Request မတင်နိုင်သေးပါ။ ${result.message || "ပြန်လည်ကြိုးစားပါ။"}`;
  }

  if (toolName === "updateContactRequest") {
    if (result.needsFollowUp) {
      return "ဖုန်းနံပါတ် သို့မဟုတ် Email အသစ်ကို ပြောပါ။";
    }

    if (result.requiresConfirmation) {
      const changeList = (result.changes || []).join(", ");
      return (
        `ဆက်သွယ်ရေးအချက်အလက် ပြောင်းလဲမည်: ${changeList}။\n` +
        "ဆက်လက်လုပ်ဆောင်ရန် CONFIRM လို့ရိုက်ထည့်ပေးပါ"
      );
    }

    if (result.submitted) {
      return (
        `ဆက်သွယ်ရေးပြောင်းလဲမှု request (ID: ${result.requestId}) တင်ပြီးပါပြီ။ ` +
        `Admin မှ မကြာမီ အတည်ပြုပေးပါမည်။`
      );
    }

    return `Request မတင်နိုင်သေးပါ။ ${result.message || "ပြန်လည်ကြိုးစားပါ။"}`;
  }

  return "Tool result ရရှိပါတယ်။";
}

// Gemini API Call handles its own timeout and configurations.

async function manualToolContext(message, user) {
  const text = message.toLowerCase();

  if (
    text.includes("parking") ||
    text.includes("slot") ||
    text.includes("ပါကင်") ||
    text.includes("ကားရပ်")
  ) {
    if (
      text.includes("latest") ||
      text.includes("recent") ||
      text.includes("history") ||
      text.includes("change") ||
      text.includes("ပြောင်း") ||
      text.includes("နောက်ဆုံး")
    ) {
      const result = await runTool("getRecentParkingEvents", {}, user);
      return {
        toolName: "getRecentParkingEvents",
        result,
      };
    }

    const result = await runTool("getParkingStatus", {}, user);
    return {
      toolName: "getParkingStatus",
      result,
    };
  }

  if (
    text.includes("sos") ||
    text.includes("alert") ||
    text.includes("emergency") ||
    text.includes("အရေးပေါ်")
  ) {
    const result = await runTool("getSOSAlerts", {}, user);
    return {
      toolName: "getSOSAlerts",
      result,
    };
  }

  if (
    text.includes("rfid") ||
    text.includes("card") ||
    text.includes("scan") ||
    text.includes("ကတ်") ||
    text.includes("စကင်")
  ) {
    const result = await runTool("getLatestRfidScans", {}, user);
    return {
      toolName: "getLatestRfidScans",
      result,
    };
  }

  if (text.includes("room") || text.includes("အခန်း")) {
    const result = await runTool("getMyRoom", {}, user);
    return {
      toolName: "getMyRoom",
      result,
    };
  }

  if (text.includes("bill") || text.includes("ဘေလ်") || text.includes("ငွေ")) {
    const result = await runTool("getMyBills", {}, user);
    return {
      toolName: "getMyBills",
      result,
    };
  }

  if (
    text.includes("helper") ||
    text.includes("maid") ||
    text.includes("အိမ်အကူ")
  ) {
    const result = await runTool("getHelpers", {}, user);
    return {
      toolName: "getHelpers",
      result,
    };
  }

  if (
    text.includes("announcement") ||
    text.includes("notice") ||
    text.includes("notification") ||
    text.includes("အသိပေး") ||
    text.includes("ကြေညာ") ||
    text.includes("အကြောင်းကြား")
  ) {
    const result = await runTool("getAnnouncements", {}, user);
    return {
      toolName: "getAnnouncements",
      result,
    };
  }

  if (
    text.includes("access") ||
    text.includes("permission") ||
    text.includes("ရပိုင်") ||
    text.includes("ခွင့်") ||
    text.includes("ခွင့်")
  ) {
    const result = await runTool("getResidentAccessInfo", {}, user);
    return {
      toolName: "getResidentAccessInfo",
      result,
    };
  }

  return null;
}

async function chat({
  message,
  conversationId,
  history = [],
  user = null,
  enableRag = true,
  audienceHint = null,
}) {
  const trimmed = message.trim();
  const resolvedConversationId = ensureConversationId(conversationId);
  const userMessage = createMessage("user", trimmed);

  let toolCalls = [];
  let knowledgeSources = [];
  let usedFallback = false;
  let assistantContent = "";
  const intent = classifyIntent(trimmed);

  if (intent.name === "emergency" || isEmergencyMessage(trimmed)) {
    assistantContent = buildEmergencyResponse();

    const assistantMessage = createMessage("assistant", assistantContent, {
      toolCalls,
      knowledgeSources,
      intent,
    });

    return {
      conversationId: resolvedConversationId,
      userMessage,
      assistantMessage,
      toolCalls,
      knowledgeSources,
      model: OLLAMA_MODEL,
      usedFallback,
      intent,
    };
  }

  try {
    // ── CONFIRM flow for high-risk actions ──────────────────────────────────
    const CONFIRM_TOOL_KEYWORDS = {
      reportLostCard: ["ကတ်ကို ပိတ်", "ပိတ်ပင်", "RFID ကတ်ကို", "deactivate", "lost card", "ကတ်ပျောက်"],
      requestReplacementCard: ["ကတ်အသစ် request", "replacement card", "replace card"],
      updateContactRequest: ["ဆက်သွယ်ရေးအချက်အလက် ပြောင်း", "update contact", "change phone", "change email"],
    };

    if (trimmed.trim().toUpperCase() === "CONFIRM") {
      const recentHistory = history.slice(-6);
      let confirmedToolName = null;
      let confirmedArgs = {};

      for (let i = recentHistory.length - 1; i >= 0; i--) {
        const entry = recentHistory[i];
        if (entry.role !== "assistant") continue;
        const content = (entry.content || "").toLowerCase();
        for (const [toolName, keywords] of Object.entries(CONFIRM_TOOL_KEYWORDS)) {
          if (keywords.some((kw) => content.includes(kw.toLowerCase()))) {
            confirmedToolName = toolName;
            // Extract any args from preceding user message
            const prevUser = recentHistory[i - 1];
            if (prevUser && prevUser.role === "user") {
              const prevText = prevUser.content || "";
              if (toolName === "updateContactRequest") {
                const phoneMatch = prevText.match(/\b09\d{7,9}\b|\b\+?95\d{8,9}\b/);
                const emailMatch = prevText.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
                if (phoneMatch) confirmedArgs.newPhone = phoneMatch[0];
                if (emailMatch) confirmedArgs.newEmail = emailMatch[0];
              }
            }
            break;
          }
        }
        if (confirmedToolName) break;
      }

      if (confirmedToolName) {
        const toolResult = await runTool(confirmedToolName, { ...confirmedArgs, confirmed: true }, user);
        toolCalls = [{ function: { name: confirmedToolName, arguments: { confirmed: true } } }];
        assistantContent = buildToolAssistantContent(confirmedToolName, toolResult);

        const assistantMessage = createMessage("assistant", assistantContent, {
          toolCalls, knowledgeSources, intent,
        });

        return {
          conversationId: resolvedConversationId,
          userMessage,
          assistantMessage,
          toolCalls,
          knowledgeSources,
          model: GEMINI_MODEL,
          usedFallback,
          intent,
        };
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    if (isToolIntent(intent)) {
      const toolResult = await runTool(intent.toolName, intent.args || {}, user);

      toolCalls = [
        {
          function: {
            name: intent.toolName,
            arguments: intent.args || {},
          },
        },
      ];
      assistantContent = buildToolAssistantContent(intent.toolName, toolResult);

      const assistantMessage = createMessage("assistant", assistantContent, {
        toolCalls,
        knowledgeSources,
        intent,
      });

      return {
        conversationId: resolvedConversationId,
        userMessage,
        assistantMessage,
        toolCalls,
        knowledgeSources,
        model: OLLAMA_MODEL,
        usedFallback,
        intent,
      };
    }

    const [toolContext, ragDocs] = await Promise.all([
      manualToolContext(trimmed, user),
      enableRag
        ? retrieveKnowledge(trimmed, user, { audienceHint }).catch((err) => {
          console.warn("[ai.service] RAG retrieval failed:", err.message);
          return [];
        })
        : Promise.resolve([]),
    ]);
    const ragContext = buildRagContext(ragDocs);

    knowledgeSources = ragDocs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      category: doc.category,
      audience: doc.audience,
    }));

    const systemInstructionParts = [
      SYSTEM_PROMPT,
      RESPONSE_STYLE_PROMPT
    ];

    const userContext = buildUserContext(user);
    if (userContext) {
      systemInstructionParts.push(userContext);
    }

    systemInstructionParts.push(`Detected intent: ${intent.name}. Confidence: ${intent.confidence}.`);

    if (ragContext) {
      systemInstructionParts.push(
        "Use the following knowledge base context when it helps answer the user. " +
        "Prefer this context over general knowledge. If neither the knowledge base nor backend tool data answers the question, say the information is not available.\n\n" +
        ragContext
      );
    }

    const geminiMessages = normalizeHistoryForGemini(history);

    if (toolContext) {
      toolCalls = [
        {
          function: {
            name: toolContext.toolName,
            arguments: {},
          },
        },
      ];

      geminiMessages.push({
        role: "user",
        parts: [{ text: `Backend tool result:\n${JSON.stringify(toolContext, null, 2)}\n\nUser question: ${trimmed}` }],
      });
    } else {
      geminiMessages.push({
        role: "user",
        parts: [{ text: trimmed }],
      });
    }

    const toolsEnabled = shouldEnableTools(trimmed);
    const config = {
      systemInstruction: systemInstructionParts.join("\n\n"),
      temperature: GEMINI_TEMPERATURE,
    };

    if (toolsEnabled) {
      const toolSchemas = getToolSchemas();
      if (toolSchemas && toolSchemas.length > 0) {
        config.tools = [{ functionDeclarations: toolSchemas }];
      }
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: geminiMessages,
      config,
    });

    if (response.functionCalls && response.functionCalls.length > 0) {
      const call = response.functionCalls[0];
      const toolName = call.name;
      const args = call.args;

      const toolResult = await runTool(toolName, args, user);
      toolCalls = [{ function: { name: toolName, arguments: args } }];
      assistantContent = buildToolAssistantContent(toolName, toolResult);
    } else {
      assistantContent = response.text?.trim();
    }

    if (!assistantContent) {
      throw new Error("Gemini returned empty response");
    }
  } catch (err) {
    console.warn("[ai.service] AI API unavailable:", err.message);
    usedFallback = true;
    assistantContent =
      "AI model response မရသေးပါ။ Gemini API connection နဲ့ Key ကိုစစ်ပါ။ " +
      "Real-time DB tool မေးခွန်းတွေကိုတော့ available ဖြစ်သလောက် ဆက်ဖြေပေးနိုင်ပါတယ်။";
  }

  const assistantMessage = createMessage("assistant", assistantContent, {
    toolCalls,
    knowledgeSources,
    intent,
  });

  return {
    conversationId: resolvedConversationId,
    userMessage,
    assistantMessage,
    toolCalls,
    knowledgeSources,
    model: GEMINI_MODEL,
    usedFallback,
    intent,
  };
}

module.exports = {
  chat,
  createMessage,
  SYSTEM_PROMPT,
  GEMINI_MODEL,
  GEMINI_TEMPERATURE,
  AI_HISTORY_LIMIT,
};
