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

const BILL_STATUSES = new Set([
  "Pending",
  "Payment Submitted",
  "Under Review",
  "Paid",
  "Rejected",
  "Overdue",
  "Pending Verification",
]);
const ANNOUNCEMENT_TYPES = new Set(["General", "Maintenance", "Event"]);
const HELPER_GENDER_PREFERENCES = new Set([
  "Male",
  "Female",
  "No Preference",
]);

const RESIDENT_ACCESS_ITEMS = [
  "View own room information",
  "View current room availability and remaining apartment count",
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
    title: bill.title || "Service bill",
    type: bill.type || "General",
    category: bill.category || "Combined",
    amount: bill.amount,
    status: bill.status,
    paymentStatus: bill.status,
    dueDate: bill.due_date,
    billingMonth: bill.billing_month || null,
    billingYear: bill.billing_year || null,
    breakdown: {
      electricity: Number(bill.electricity_amount || 0),
      water: Number(bill.water_amount || 0),
      apartmentInstallment: Number(bill.installment_amount || 0),
      maintenance: Number(bill.maintenance_amount || 0),
      serviceFee: Number(bill.service_amount || 0),
      other: Number(bill.other_amount || 0),
      otherDescription: bill.other_description || "",
    },
    paidAt: bill.paid_at || null,
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

async function getSOSAlerts(args = {}, user) {
  const limit = Math.min(Math.max(Number(args.limit || 5), 1), 20);
  const filter = {};
  const currentUser = await getCurrentUser(user);
  const isManager = ["Admin", "Staff", "Security"].includes(currentUser?.role);

  if (!currentUser) return { count: 0, alerts: [], message: "Login required" };
  if (!isManager) filter.resident_id = currentUser._id;

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

async function getLatestRfidScans(args = {}, user) {
  const limit = Math.min(Math.max(Number(args.limit || 5), 1), 20);
  const filter = {};
  const currentUser = await getCurrentUser(user);
  const isManager = ["Admin", "Staff", "Security"].includes(currentUser?.role);

  if (!currentUser) return { count: 0, scans: [], message: "Login required" };
  if (!isManager) filter.resident_id = currentUser._id;

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

async function getRoomAvailability(args = {}, user) {
  const currentUser = await getCurrentUser(user);
  const isManager = ["Admin", "Staff"].includes(currentUser?.role);
  const rooms = await Room.find({})
    .sort({ building: 1, floor: 1, room_name: 1 })
    .populate("resident_id", "fullname role resident_uid")
    .lean();
  const available = rooms.filter(
    (room) => room.status === "Available" && !room.resident_id,
  );
  const maintenance = rooms.filter((room) => room.status === "Maintenance");
  const occupied = rooms.filter(
    (room) => room.status === "Occupied" || Boolean(room.resident_id),
  );
  const mapRoom = (room) => ({
    id: String(room._id),
    roomNumber: room.room_name,
    building: room.building,
    floor: room.floor,
    roomType: room.room_type,
    status: room.status,
    ...(isManager
      ? {
          ownerName: room.owner_name || room.resident_id?.fullname || "",
          residentName: room.resident_id?.fullname || null,
          residentId: room.resident_id?._id
            ? String(room.resident_id._id)
            : null,
        }
      : {}),
  });

  return {
    totalRooms: rooms.length,
    availableCount: available.length,
    occupiedCount: occupied.length,
    maintenanceCount: maintenance.length,
    availableRooms: available.map(mapRoom),
    rooms: isManager ? rooms.map(mapRoom) : available.map(mapRoom),
    scope: isManager ? "all_rooms" : "availability_only",
    requestedDetail: args.detail || "summary",
  };
}

function getCurrentDateTime() {
  const now = new Date();
  const timeZone = process.env.AI_TIME_ZONE || "Asia/Yangon";
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
  });

  return {
    iso: now.toISOString(),
    timeZone,
    localDate: dateFormatter.format(now),
    localTime: timeFormatter.format(now),
    weekday: weekdayFormatter.format(now),
  };
}

async function getMyBills(user, args = {}) {
  const resolved = await resolveCurrentRoom(user);
  const limit = parseLimit(args.limit, 5, 20);
  const monthRange = resolveMonthRange(args);
  const status = normalizeEnum(args.status, BILL_STATUSES);

  if (!resolved.found) {
    const legacyRoomNumber = String(resolved.user?.room_id || "").trim();

    // Some legacy resident accounts still contain a room label instead of a
    // Room ObjectId. We cannot safely attach bills without a real Room record,
    // but a read-only bill query should return an empty result rather than look
    // like an application failure.
    if (legacyRoomNumber) {
      return {
        found: true,
        roomLinked: false,
        message: resolved.message,
        roomNumber: legacyRoomNumber,
        bills: [],
        totalOutstanding: 0,
        monthlySummary: {
          year: monthRange.year,
          month: monthRange.month,
          label: monthRange.label,
          count: 0,
          totalAmount: 0,
          paidAmount: 0,
          unpaidAmount: 0,
          overdueAmount: 0,
          bills: [],
        },
      };
    }

    return {
      found: false,
      message: resolved.message,
      bills: [],
      totalOutstanding: 0,
      monthlySummary: null,
    };
  }

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

  const filter = {
    target_room_id: resolved.room._id,
    registered_by: resolved.user._id,
  };

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
    requested_by: resolved.user._id,
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
  const clauses = [
    { $or: [{ status: "Active" }, { status: { $exists: false } }] },
  ];
  const q = String(args.q || args.query || "").trim();

  const type = normalizeEnum(args.type, ANNOUNCEMENT_TYPES);

  if (type) {
    filter.type = type;
  }

  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    clauses.push({ $or: [{ title: regex }, { message: regex }] });
  }

  const currentUser = await getCurrentUser(user);
  if (currentUser && !["Admin", "Staff"].includes(currentUser.role)) {
    const resolved = await resolveCurrentRoom(currentUser);
    clauses.push({
      $or: [
        { audience_type: "All Residents" },
        { audience_type: { $exists: false } },
        ...(resolved.found
          ? [
              {
                audience_type: "Building",
                audience_building: resolved.room.building,
              },
              {
                audience_type: "Floor",
                audience_floor: resolved.room.floor,
                $or: [
                  { audience_building: resolved.room.building },
                  { audience_building: "" },
                ],
              },
              {
                audience_type: "Room",
                audience_room_id: resolved.room._id,
              },
            ]
          : []),
      ],
    });
  }
  filter.$and = clauses;
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

// ─────────────────────────────────────────────────────────────────
// NEW HomeMate tools
// ─────────────────────────────────────────────────────────────────

async function registerVisitor(args = {}, user) {
  const resolved = await resolveCurrentRoom(user);

  if (!resolved.found) {
    return { registered: false, message: resolved.message };
  }

  const name = String(args.name || "").trim();
  const phone = String(args.phone || "").trim();
  const purpose = String(args.purpose || "General").trim();
  const visitDate = String(args.visitDate || args.visit_date || "").trim();
  const visitTime = String(args.visitTime || args.visit_time || "").trim();

  if (!name || !phone) {
    return {
      registered: false,
      needsFollowUp: true,
      message: "Visitor name and phone number are required",
      missingFields: [!name ? "name" : null, !phone ? "phone" : null].filter(Boolean),
    };
  }

  const nameParts = name.split(" ");
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ") || "-";

  const visitor = await Visitor.create({
    firstName,
    lastName,
    phone,
    email: `visitor_${Date.now()}@homemate.local`,
    purpose,
    purposeDetail: visitDate && visitTime ? `${visitDate} ${visitTime}` : "",
    hostName: resolved.user.fullname || "Resident",
    agreedToTerms: true,
    registered_by: resolved.user._id,
    target_room_id: resolved.room._id,
  });

  return {
    registered: true,
    visitorId: String(visitor._id),
    visitorUid: visitor.visitor_uid,
    badgeNumber: visitor.badgeNumber,
    name: visitor.fullname,
    purpose,
    roomNumber: resolved.room.room_name,
  };
}

async function reserveVisitorParking(args = {}, user) {
  const resolved = await resolveCurrentRoom(user);

  if (!resolved.found) {
    return { reserved: false, message: resolved.message };
  }

  const vehicleNumber = String(args.vehicleNumber || args.vehicle_number || "").trim();
  const date = String(args.date || "").trim();
  const durationHours = Number(args.durationHours || args.duration_hours || 2);

  if (!vehicleNumber || !date) {
    return {
      reserved: false,
      needsFollowUp: true,
      message: "Vehicle number and date are required",
      missingFields: [!vehicleNumber ? "vehicleNumber" : null, !date ? "date" : null].filter(Boolean),
    };
  }

  const parking = await Parking.findOne({ type: "visitor" }).lean();

  if (!parking || parking.availableSlot <= 0) {
    return {
      reserved: false,
      message: "No visitor parking slots available at the moment",
    };
  }

  await Notification.create({
    user_id: resolved.user._id,
    title: "Visitor Parking Request",
    message: `Room ${resolved.room.room_name}: Vehicle ${vehicleNumber} requests visitor parking on ${date} for ${durationHours}h.`,
    type: "parking",
    data: { vehicleNumber, date, durationHours, roomNumber: resolved.room.room_name },
  });

  return {
    reserved: true,
    vehicleNumber,
    date,
    durationHours,
    roomNumber: resolved.room.room_name,
    availableSlots: parking.availableSlot,
    message: "Parking reservation request submitted. Admin will confirm your slot.",
  };
}

async function reportLostCard(args = {}, user) {
  const currentUser = await getCurrentUser(user);

  if (!currentUser) {
    return { reported: false, message: "Login required" };
  }

  if (!args.confirmed) {
    return {
      reported: false,
      requiresConfirmation: true,
      message: "CONFIRM required to deactivate this card",
    };
  }

  const previousUid = currentUser.rfid_uid || null;

  await User.findByIdAndUpdate(currentUser._id, {
    $set: { rfid_uid: null, card_status: "lost" },
  });

  await Notification.create({
    user_id: currentUser._id,
    title: "RFID Card Reported Lost",
    message: `Card UID ${previousUid || "N/A"} has been deactivated for ${currentUser.fullname}. Please request a replacement.`,
    type: "security",
    data: { previousUid, userId: String(currentUser._id) },
  });

  return {
    reported: true,
    deactivated: true,
    previousUid,
    message: "Your RFID card has been deactivated and admin has been notified.",
  };
}

async function requestReplacementCard(args = {}, user) {
  const resolved = await resolveCurrentRoom(user);

  if (!resolved.found) {
    return { requested: false, message: resolved.message };
  }

  if (!args.confirmed) {
    return {
      requested: false,
      requiresConfirmation: true,
      message: "CONFIRM required to submit replacement card request",
    };
  }

  const cardType = String(args.cardType || args.card_type || "Standard").trim();

  const notification = await Notification.create({
    user_id: resolved.user._id,
    title: "Replacement Card Request",
    message: `Room ${resolved.room.room_name}: ${resolved.user.fullname} requests a replacement RFID card (type: ${cardType}).`,
    type: "admin",
    data: { cardType, roomNumber: resolved.room.room_name },
  });

  return {
    requested: true,
    requestId: String(notification._id),
    cardType,
    roomNumber: resolved.room.room_name,
    message: "Replacement card request submitted. Admin will process it shortly.",
  };
}

async function updateContactRequest(args = {}, user) {
  const currentUser = await getCurrentUser(user);

  if (!currentUser) {
    return { submitted: false, message: "Login required" };
  }

  const newPhone = String(args.newPhone || args.new_phone || "").trim();
  const newEmail = String(args.newEmail || args.new_email || "").trim();

  if (!newPhone && !newEmail) {
    return {
      submitted: false,
      needsFollowUp: true,
      message: "Please provide the new phone number or email to update",
    };
  }

  if (!args.confirmed) {
    return {
      submitted: false,
      requiresConfirmation: true,
      message: "CONFIRM required to submit contact update request",
    };
  }

  const changes = [];
  if (newPhone) changes.push(`Phone: ${newPhone}`);
  if (newEmail) changes.push(`Email: ${newEmail}`);

  const notification = await Notification.create({
    user_id: currentUser._id,
    title: "Contact Update Request",
    message: `${currentUser.fullname} requests contact update: ${changes.join(", ")}.`,
    type: "admin",
    data: { newPhone: newPhone || null, newEmail: newEmail || null, userId: String(currentUser._id) },
  });

  return {
    submitted: true,
    requestId: String(notification._id),
    changes,
    message: "Your contact update request has been sent to admin for processing.",
  };
}

async function getResidentAccessInfo(user) {
  const currentUser = await getCurrentUser(user);

  return {
    role: currentUser?.role || user?.role || "Resident",
    isLoggedIn: Boolean(currentUser || getUserId(user)),
    permissions: RESIDENT_ACCESS_ITEMS,
    privacyNote:
      "Resident data is limited to the logged-in user's linked room/account where applicable.",
  };
}

function getAdminContact() {
  const configured = String(
    process.env.ADMIN_CONTACT_PHONES || "09455507081,09965139303",
  )
    .split(/[,/]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    phones: configured,
    message: "PrimeCity admin contact numbers",
  };
}

async function getResidentPopulation() {
  const [residentCount, occupiedRoomCount] = await Promise.all([
    User.countDocuments({ role: { $in: ["Resident", "Citizen"] } }),
    Room.countDocuments({
      $or: [{ status: "Occupied" }, { resident_id: { $ne: null } }],
    }),
  ]);

  return {
    residentCount,
    occupiedRoomCount,
    scope: "aggregate_only",
    privacyNote: "No resident names or personal records are included.",
  };
}

function describeWeatherCode(code) {
  if (code === 0) return "ကြည်လင်";
  if ([1, 2, 3].includes(code)) return "တိမ်အသင့်အတင့်";
  if ([45, 48].includes(code)) return "မြူထူ";
  if ([51, 53, 55, 56, 57].includes(code)) return "မိုးဖွဲ";
  if ([61, 63, 65, 66, 67].includes(code)) return "မိုးရွာ";
  if ([71, 73, 75, 77].includes(code)) return "နှင်းကျ";
  if ([80, 81, 82].includes(code)) return "မိုးတိမ်တောင်";
  if ([85, 86].includes(code)) return "နှင်းတိမ်တောင်";
  if ([95, 96, 99].includes(code)) return "မိုးကြိုးမုန်တိုင်း";
  return "ရာသီဥတုအခြေအနေ မသတ်မှတ်နိုင်";
}

async function getWeather() {
  const latitude = Number(process.env.WEATHER_LATITUDE || 16.8661);
  const longitude = Number(process.env.WEATHER_LONGITUDE || 96.1951);
  const locationName = process.env.WEATHER_LOCATION_NAME || "Yangon";
  const timeZone = process.env.WEATHER_TIMEZONE || "Asia/Yangon";
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: timeZone,
    forecast_days: "3",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
      { signal: controller.signal },
    );

    if (!response.ok) {
      throw new Error(`Weather service returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const current = data.current || {};
    const daily = data.daily || {};

    return {
      available: true,
      source: "Open-Meteo",
      locationName,
      latitude,
      longitude,
      timeZone: data.timezone || timeZone,
      observedAt: current.time || null,
      current: {
        temperatureC: current.temperature_2m,
        apparentTemperatureC: current.apparent_temperature,
        humidityPercent: current.relative_humidity_2m,
        precipitationMm: current.precipitation,
        rainMm: current.rain,
        windSpeedKmh: current.wind_speed_10m,
        weatherCode: current.weather_code,
        description: describeWeatherCode(current.weather_code),
      },
      forecast: (daily.time || []).map((date, index) => ({
        date,
        description: describeWeatherCode(daily.weather_code?.[index]),
        maxTemperatureC: daily.temperature_2m_max?.[index],
        minTemperatureC: daily.temperature_2m_min?.[index],
        precipitationProbabilityPercent:
          daily.precipitation_probability_max?.[index],
      })),
    };
  } catch (err) {
    return {
      available: false,
      source: "Open-Meteo",
      locationName,
      message:
        err.name === "AbortError"
          ? "Weather service timed out"
          : err.message || "Weather service unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
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
      return getSOSAlerts(args, user);

    case "getLatestRfidScans":
      return getLatestRfidScans(args, user);

    case "getMyRoom":
      return getMyRoom(user);

    case "getRoomAvailability":
      return getRoomAvailability(args, user);

    case "getCurrentDateTime":
      return getCurrentDateTime();

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

    case "getAdminContact":
      return getAdminContact();

    case "getResidentPopulation":
      return getResidentPopulation();

    case "getWeather":
      return getWeather();

    case "registerVisitor":
      return registerVisitor(args, user);

    case "reserveVisitorParking":
      return reserveVisitorParking(args, user);

    case "reportLostCard":
      return reportLostCard(args, user);

    case "requestReplacementCard":
      return requestReplacementCard(args, user);

    case "updateContactRequest":
      return updateContactRequest(args, user);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = {
  runTool,
  resolveCurrentRoom,
  getMyProfile,
  getRoomAvailability,
  getCurrentDateTime,
  getMyBills,
  getMyVisitors,
  getResidentPopulation,
  getAdminContact,
  getWeather,
  registerVisitor,
  reserveVisitorParking,
  reportLostCard,
  requestReplacementCard,
  updateContactRequest,
};
