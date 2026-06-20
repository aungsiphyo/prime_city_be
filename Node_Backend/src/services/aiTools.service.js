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

function getUserId(user) {
  return user?.id || user?._id || null;
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
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

async function getMyBills(user) {
  const resolved = await resolveCurrentRoom(user);

  if (!resolved.found) {
    return {
      found: false,
      message: resolved.message,
      bills: [],
      totalOutstanding: 0,
    };
  }

  const bills = await ServiceBill.find({ room_id: resolved.room._id })
    .sort({ created_at: -1 })
    .limit(5)
    .lean();
  const totalOutstanding = bills
    .filter((bill) => bill.status !== "Paid")
    .reduce((total, bill) => total + Number(bill.amount || 0), 0);

  return {
    found: true,
    roomNumber: resolved.room.room_name,
    totalOutstanding,
    bills: bills.map((bill) => ({
      id: String(bill._id),
      amount: bill.amount,
      status: bill.status,
      dueDate: bill.due_date,
      createdAt: bill.created_at,
    })),
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

async function runTool(name, args = {}, user) {
  switch (name) {
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
      return getMyBills(user);

    case "getMyVisitors":
      return getMyVisitors(user, args);

    case "createMaintenanceRequest":
      return createMaintenanceRequest(args, user);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = {
  runTool,
  resolveCurrentRoom,
};
