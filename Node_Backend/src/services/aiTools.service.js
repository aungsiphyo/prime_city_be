const mongoose = require("mongoose");
const Parking = require("../models/Parking");
const ParkingEvent = require("../models/ParkingEvent");
const RfidScanLog = require("../models/RfidScanLog");
const Room = require("../models/Room");
const SosAlert = require("../models/SosAlert");
const User = require("../models/User");
const ServiceBill = require("../models/ServiceBill");
const Visitor = require("../models/Visitor");
const Report = require("../models/Report");
const Announcement = require("../models/Announcement");
const Notification = require("../models/Notification");
const Helper = require("../models/Helper");
const HelperRequest = require("../models/HelperRequest");

const BILL_STATUSES = new Set(["Pending", "Paid", "Overdue"]);
const ANNOUNCEMENT_TYPES = new Set(["General", "Maintenance", "Event"]);
const HELPER_GENDER_PREFERENCES = new Set([
  "Male",
  "Female",
  "No Preference",
]);

const RESIDENT_ACCESS_ITEMS = [
  "View own room information",
  "View own service bills, unpaid total, and monthly bill total",
  "View own visitor records",
  "View community announcements and own notifications",
  "View available house helpers",
  "Request a house helper for the linked room",
  "Create maintenance or repair requests",
  "Ask parking slot status and recent parking changes",
  "Ask RFID scan status where allowed by management",
  "Use SOS guidance and app SOS features",
  "Ask resident-facing rules, policies, and app guidance",
];

function getUserId(user) {
  return user?.id || user?._id || null;
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function normalizeEnum(value, allowedValues) {
  const text = String(value || "").trim().toLowerCase();

  if (!text) return null;

  return Array.from(allowedValues).find(
    (allowedValue) => allowedValue.toLowerCase() === text,
  ) || null;
}

function parseLimit(value, fallback = 5, max = 20) {
  const parsed = Number(value);
  const safeValue = Number.isFinite(parsed) ? parsed : fallback;

  return Math.min(Math.max(safeValue, 1), max);
}

function sumAmounts(items) {
  return items.reduce((total, item) => total + Number(item.amount || 0), 0);
}

function mapBill(bill) {
  return {
    id: String(bill._id),
    amount: bill.amount,
    status: bill.status,
    dueDate: bill.due_date,
    createdAt: bill.created_at,
  };
}

function resolveMonthRange(args = {}) {
  const now = new Date();
  const parsedYear = Number(args.year);
  const parsedMonth = Number(args.month);
  const year = Number.isInteger(parsedYear) && parsedYear >= 1970
    ? parsedYear
    : now.getFullYear();
  const month = Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
    ? parsedMonth
    : now.getMonth() + 1;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  return {
    year,
    month,
    start,
    end,
    label: `${year}-${String(month).padStart(2, "0")}`,
  };
}

function normalizeGenderPreference(value) {
  const exact = normalizeEnum(value, HELPER_GENDER_PREFERENCES);

  if (exact) return exact;

  const text = String(value || "").trim().toLowerCase();

  if (["male", "man", "အမျိုးသား", "ယောက်ျား"].includes(text)) return "Male";
  if (["female", "woman", "အမျိုးသမီး", "မိန်းကလေး"].includes(text)) {
    return "Female";
  }

  return "No Preference";
}

function normalizeHelperType(value) {
  const text = String(value || "").trim();

  if (!text) return "House Helper";

  return text.slice(0, 80);
}

async function getCurrentUser(user) {
  const userId = getUserId(user);

  if (!userId) return null;

  return User.findById(userId)
    .select("_id fullname email phone role room_id resident_uid")
    .lean();
}

async function resolveCurrentRoom(user) {
  const currentUser = await getCurrentUser(user);

  if (!currentUser) {
    return {
      found: false,
      message: "Login required",
      user: null,
      room: null,
    };
  }

  const linkedRoom = await Room.findOne({ resident_id: currentUser._id }).lean();

  if (linkedRoom) {
    return {
      found: true,
      message: "Room found",
      user: currentUser,
      room: linkedRoom,
    };
  }

  const roomRef = String(currentUser.room_id || "").trim();

  if (!roomRef) {
    return {
      found: false,
      message: "No room is linked to this user account",
      user: currentUser,
      room: null,
    };
  }

  const query = isObjectId(roomRef)
    ? { $or: [{ _id: roomRef }, { room_name: roomRef }] }
    : { room_name: roomRef };
  const room = await Room.findOne(query).lean();

  if (!room) {
    return {
      found: false,
      message: "Linked room was not found",
      user: currentUser,
      room: null,
    };
  }

  return {
    found: true,
    message: "Room found",
    user: currentUser,
    room,
  };
}

async function getMyProfile(user, args = {}) {
  const resolved = await resolveCurrentRoom(user);
  const currentUser = resolved.user;

  if (!currentUser) {
    return {
      found: false,
      message: "Login required",
    };
  }

  return {
    found: true,
    message: resolved.message,
    name: currentUser.fullname,
    email: currentUser.email,
    phone: currentUser.phone,
    role: currentUser.role,
    residentUid: currentUser.resident_uid || null,
    roomNumber: resolved.room?.room_name || currentUser.room_id || null,
    roomLinked: Boolean(resolved.found),
    requestedField: args.field || "profile",
  };
}

async function getParkingStatus() {
  const visitor = await Parking.findOne({ type: "visitor" }).lean();
  const resident = await Parking.findOne({ type: "resident" }).lean();

  return {
    visitor: {
      totalSlot: visitor?.totalSlot || 0,
      usedSlot: visitor?.usedSlot || 0,
      availableSlot: visitor?.availableSlot || 0,
      maintenanceSlot: visitor?.maintenanceSlot || 0,
    },
    resident: {
      totalSlot: resident?.totalSlot || 0,
      usedSlot: resident?.usedSlot || 0,
      availableSlot: resident?.availableSlot || 0,
      maintenanceSlot: resident?.maintenanceSlot || 0,
    },
  };
}

async function getRecentParkingEvents(args = {}) {
  const limit = Math.min(Math.max(Number(args.limit || 5), 1), 20);
  const filter = {};

  if (["visitor", "resident"].includes(args.type)) {
    filter.type = args.type;
  }

  const events = await ParkingEvent.find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .lean();

  return {
    count: events.length,
    events: events.map((event) => ({
      id: String(event._id),
      type: event.type,
      delta: event.delta,
      source: event.source,
      deviceId: event.device_id || null,
      previousUsedSlot: event.previousUsedSlot,
      usedSlot: event.usedSlot,
      previousAvailableSlot: event.previousAvailableSlot,
      availableSlot: event.availableSlot,
      totalSlot: event.totalSlot,
      maintenanceSlot: event.maintenanceSlot,
      createdAt: event.created_at || event.createdAt,
    })),
  };
}

async function getSOSAlerts(args = {}) {
  const limit = Math.min(Math.max(Number(args.limit || 5), 1), 20);
  const filter = {};

  if (args.status) filter.status = args.status;

  const alerts = await SosAlert.find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .populate("resident_id", "fullname email phone role")
    .populate("room_id")
    .lean();

  return {
    count: alerts.length,
    alerts: alerts.map((alert) => ({
      id: String(alert._id),
      message: alert.message,
      source: alert.source,
      status: alert.status,
      alertType: alert.alert_type,
      priority: alert.priority,
      deviceId: alert.device_id || null,
      residentName: alert.resident_id?.fullname || null,
      roomName: alert.room_id?.room_name || null,
      createdAt: alert.created_at,
      resolvedAt: alert.resolved_at || null,
    })),
  };
}

async function getLatestRfidScans(args = {}) {
  const limit = Math.min(Math.max(Number(args.limit || 5), 1), 20);
  const filter = {};

  if (args.valid === true || args.valid === false) filter.valid = args.valid;
  if (args.personType) filter.personType = args.personType;

  const scans = await RfidScanLog.find(filter)
    .sort({ scanned_at: -1 })
    .limit(limit)
    .populate("resident_id", "fullname email phone role resident_uid rfid_uid")
    .populate("visitor_id", "fullname phone email visitor_uid rfid_uid")
    .populate("room_id")
    .lean();

  return {
    count: scans.length,
    scans: scans.map((scan) => ({
      id: String(scan._id),
      valid: scan.valid,
      message: scan.message,
      source: scan.source,
      deviceId: scan.device_id || null,
      hardwareUid: scan.hardwareUid || null,
      cardCode: scan.cardCode || null,
      personType: scan.personType || null,
      matchType: scan.matchType || null,
      residentName: scan.resident_id?.fullname || null,
      visitorName: scan.visitor_id?.fullname || null,
      roomName: scan.room_id?.room_name || null,
      scannedAt: scan.scanned_at,
    })),
  };
}

async function getMyRoom(user) {
  const resolved = await resolveCurrentRoom(user);

  if (!resolved.found) {
    return {
      found: false,
      message: resolved.message,
    };
  }

  return {
    found: true,
    roomNumber: resolved.room.room_name,
    ownerName: resolved.room.owner_name || resolved.user.fullname || "",
    floor: resolved.room.floor,
    roomType: resolved.room.room_type,
    status: resolved.room.status,
    residentId: resolved.room.resident_id || resolved.user._id,
  };
}

async function getMyBills(user, args = {}) {
  const resolved = await resolveCurrentRoom(user);

  if (!resolved.found) {
    return {
      found: false,
      message: resolved.message,
      bills: [],
      totalOutstanding: 0,
      monthlySummary: null,
    };
  }

  const limit = parseLimit(args.limit, 5, 20);
  const monthRange = resolveMonthRange(args);
  const status = normalizeEnum(args.status, BILL_STATUSES);
  const roomFilter = { room_id: resolved.room._id };
  const statusFilter = status ? { status } : {};

  const [bills, outstandingBills, monthlyBills] = await Promise.all([
    ServiceBill.find({ ...roomFilter, ...statusFilter })
      .sort({ created_at: -1 })
      .limit(limit)
      .lean(),
    ServiceBill.find({ ...roomFilter, status: { $ne: "Paid" } })
      .select("amount status")
      .lean(),
    ServiceBill.find({
      ...roomFilter,
      ...statusFilter,
      due_date: { $gte: monthRange.start, $lt: monthRange.end },
    })
      .sort({ due_date: 1, created_at: -1 })
      .lean(),
  ]);
  const totalOutstanding = sumAmounts(outstandingBills);
  const monthlyPaid = monthlyBills.filter((bill) => bill.status === "Paid");
  const monthlyUnpaid = monthlyBills.filter((bill) => bill.status !== "Paid");
  const monthlyOverdue = monthlyBills.filter((bill) => bill.status === "Overdue");

  return {
    found: true,
    roomNumber: resolved.room.room_name,
    totalOutstanding,
    monthlySummary: {
      year: monthRange.year,
      month: monthRange.month,
      label: monthRange.label,
      count: monthlyBills.length,
      totalAmount: sumAmounts(monthlyBills),
      paidAmount: sumAmounts(monthlyPaid),
      unpaidAmount: sumAmounts(monthlyUnpaid),
      overdueAmount: sumAmounts(monthlyOverdue),
      bills: monthlyBills.map(mapBill),
    },
    bills: bills.map(mapBill),
  };
}

async function getMyVisitors(user, args = {}) {
  const resolved = await resolveCurrentRoom(user);

  if (!resolved.found) {
    return {
      found: false,
      message: resolved.message,
      visitors: [],
    };
  }

  const filter = { target_room_id: resolved.room._id };

  if (args.today) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    filter.createdAt = { $gte: start, $lte: end };
  }

  const visitors = await Visitor.find(filter)
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  return {
    found: true,
    roomNumber: resolved.room.room_name,
    visitors: visitors.map((visitor) => ({
      id: String(visitor._id),
      visitorUid: visitor.visitor_uid,
      name: visitor.fullname,
      phone: visitor.phone,
      purpose: visitor.purpose,
      badgeNumber: visitor.badgeNumber,
      checkInTime: visitor.check_in_time,
      checkOutTime: visitor.check_out_time,
      createdAt: visitor.createdAt,
    })),
  };
}

async function createMaintenanceRequest(args = {}, user) {
  const resolved = await resolveCurrentRoom(user);

  if (!resolved.found) {
    return {
      created: false,
      needsFollowUp: false,
      message: resolved.message,
    };
  }

  const title = String(args.title || "").trim();
  const description = String(args.description || "").trim();

  if (!title || !description || args.hasUsefulDetail === false) {
    return {
      created: false,
      needsFollowUp: true,
      message: "Maintenance request detail is required",
      requiredFields: ["problem description"],
      roomNumber: resolved.room.room_name,
    };
  }

  const report = await Report.create({
    title: title.slice(0, 120),
    message: description.slice(0, 2000),
    type: "Maintenance",
    location: resolved.room.room_name,
    user_id: resolved.user._id,
  });

  return {
    created: true,
    reportId: String(report._id),
    roomNumber: resolved.room.room_name,
    status: report.status,
    title: report.title,
  };
}

async function getHelpers(args = {}) {
  const limit = parseLimit(args.limit, 10, 50);
  const filter = {};

  if (args.status) {
    filter.status = String(args.status).trim();
  } else if (args.activeOnly !== false) {
    filter.status = "Active";
  }

  const gender = normalizeEnum(args.gender, new Set(["Male", "Female"]));

  if (gender) {
    filter.gender = gender;
  }

  const helpers = await Helper.find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .lean();

  return {
    count: helpers.length,
    helpers: helpers.map((helper) => ({
      id: String(helper._id),
      name: helper.fullname,
      age: helper.age || null,
      gender: helper.gender || null,
      experience: helper.experience || 0,
      photo: helper.photo || null,
      status: helper.status || "Active",
      createdAt: helper.created_at,
    })),
  };
}

async function createHelperRequest(args = {}, user) {
  const resolved = await resolveCurrentRoom(user);

  if (!resolved.found) {
    return {
      created: false,
      message: resolved.message,
    };
  }

  const requestType = normalizeHelperType(args.type || args.serviceType);
  const genderPreferred = normalizeGenderPreference(args.gender_preferred);
  const request = await HelperRequest.create({
    room_id: resolved.room._id,
    type: requestType,
    gender_preferred: genderPreferred,
  });

  return {
    created: true,
    requestId: String(request._id),
    roomNumber: resolved.room.room_name,
    type: request.type,
    genderPreferred: request.gender_preferred,
    status: request.status,
    createdAt: request.created_at,
  };
}

async function getAnnouncements(args = {}, user) {
  const limit = parseLimit(args.limit, 5, 20);
  const filter = {};
  const q = String(args.q || args.query || "").trim();

  const type = normalizeEnum(args.type, ANNOUNCEMENT_TYPES);

  if (type) {
    filter.type = type;
  }

  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ title: regex }, { message: regex }];
  }

  const currentUser = await getCurrentUser(user);
  const notificationFilter = currentUser ? { user_id: currentUser._id } : null;
  const [announcements, notifications] = await Promise.all([
    Announcement.find(filter).sort({ created_at: -1 }).limit(limit).lean(),
    notificationFilter
      ? Notification.find(notificationFilter)
          .sort({ created_at: -1 })
          .limit(limit)
          .lean()
      : Promise.resolve([]),
  ]);

  return {
    count: announcements.length,
    notificationCount: notifications.length,
    announcements: announcements.map((announcement) => ({
      id: String(announcement._id),
      title: announcement.title,
      message: announcement.message,
      type: announcement.type,
      createdAt: announcement.created_at,
    })),
    notifications: notifications.map((notification) => ({
      id: String(notification._id),
      title: notification.title,
      message: notification.message,
      type: notification.type,
      isRead: notification.is_read,
      createdAt: notification.created_at,
    })),
  };
}

async function getResidentAccessInfo(user) {
  const currentUser = await getCurrentUser(user);

  return {
    role: currentUser?.role || user?.role || "Citizen",
    isLoggedIn: Boolean(currentUser || getUserId(user)),
    permissions: RESIDENT_ACCESS_ITEMS,
    privacyNote:
      "Resident data is limited to the logged-in user's linked room/account where applicable.",
  };
}

async function runTool(name, args = {}, user) {
  switch (name) {
    case "getMyProfile":
      return getMyProfile(user, args);

    case "getParkingStatus":
      return getParkingStatus();

    case "getRecentParkingEvents":
      return getRecentParkingEvents(args);

    case "getSOSAlerts":
      return getSOSAlerts(args);

    case "getLatestRfidScans":
      return getLatestRfidScans(args);

    case "getMyRoom":
      return getMyRoom(user);

    case "getMyBills":
      return getMyBills(user, args);

    case "getMyVisitors":
      return getMyVisitors(user, args);

    case "createMaintenanceRequest":
      return createMaintenanceRequest(args, user);

    case "getHelpers":
      return getHelpers(args);

    case "createHelperRequest":
      return createHelperRequest(args, user);

    case "getAnnouncements":
      return getAnnouncements(args, user);

    case "getResidentAccessInfo":
      return getResidentAccessInfo(user);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = {
  runTool,
  resolveCurrentRoom,
  getMyProfile,
};
