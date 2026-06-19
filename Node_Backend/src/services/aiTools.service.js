const mongoose = require("mongoose");
const Parking = require("../models/Parking");
const Room = require("../models/Room");
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
    floor: resolved.room.floor,
    roomType: resolved.room.room_type,
    status: resolved.room.status,
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
