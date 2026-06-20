const Parking = require("../models/Parking");
const Room = require("../models/Room");

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
  if (!user?.id) {
    return {
      found: false,
      message: "Login user not found",
    };
  }

  const room = await Room.findOne({ userId: user.id }).lean();

  if (!room) {
    return {
      found: false,
      message: "Room not found",
    };
  }

  return {
    found: true,
    roomNumber: room.roomNumber,
    floor: room.floor,
    status: room.status,
  };
}

async function runTool(name, args, user) {
  switch (name) {
    case "getParkingStatus":
      return getParkingStatus();

    case "getMyRoom":
      return getMyRoom(user);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = {
  runTool,
};
