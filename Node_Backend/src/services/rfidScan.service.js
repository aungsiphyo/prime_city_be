const mongoose = require("mongoose");
const Room = require("../models/Room");
const RfidScanLog = require("../models/RfidScanLog");
const User = require("../models/User");
const Visitor = require("../models/Visitor");

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function normalizeRfidUid(value) {
  return String(value || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase();
}

async function findResidentRoom(resident) {
  const linkedRoom = await Room.findOne({ resident_id: resident._id }).lean();

  if (linkedRoom) return linkedRoom;

  const roomRef = String(resident.room_id || "").trim();

  if (!roomRef) return null;

  const query = isObjectId(roomRef)
    ? { $or: [{ _id: roomRef }, { room_name: roomRef }] }
    : { room_name: roomRef };

  return Room.findOne(query).lean();
}

function getScanInput(data = {}) {
  return {
    cardCode: String(
      data.cardCode || data.residentUid || data.resident_uid || data.visitor_uid || "",
    ).trim(),
    hardwareUid: normalizeRfidUid(data.hardwareUid || data.rfidUid || data.rfid_uid),
    source: String(data.source || "rfid_scan").trim(),
    scannedAt: new Date().toISOString(),
  };
}

function buildResult(statusCode, response, eventPayload = response) {
  return { statusCode, response, eventPayload };
}

function objectIdOrUndefined(value) {
  return isObjectId(value) ? value : undefined;
}

async function validateRfidScan(data = {}) {
  const { cardCode, hardwareUid, source, scannedAt } = getScanInput(data);

  if (!cardCode && !hardwareUid) {
    return buildResult(400, {
      success: false,
      valid: false,
      message: "cardCode or hardwareUid is required",
    });
  }

  const residentQuery = [];
  if (cardCode) residentQuery.push({ resident_uid: cardCode });
  if (hardwareUid) residentQuery.push({ rfid_uid: hardwareUid });

  const resident = await User.findOne({
    role: "Resident",
    $or: residentQuery,
  })
    .select("_id resident_uid rfid_uid fullname email phone role room_id")
    .lean();

  if (!resident) {
    const visitorQuery = [];
    if (cardCode) visitorQuery.push({ visitor_uid: cardCode });
    if (hardwareUid) visitorQuery.push({ rfid_uid: hardwareUid });

    const visitor =
      visitorQuery.length > 0
        ? await Visitor.findOne({ $or: visitorQuery })
          .select(
            "_id visitor_uid rfid_uid fullname firstName lastName phone email badgeNumber hostName purpose check_in_time check_out_time",
          )
          .lean()
        : null;

    if (visitor) {
      const validPayload = {
        valid: true,
        personType: "visitor",
        matchType:
          hardwareUid && visitor.rfid_uid === hardwareUid ? "hardwareUid" : "cardCode",
        cardCode: cardCode || null,
        hardwareUid: hardwareUid || null,
        source,
        scannedAt,
        visitor: {
          id: String(visitor._id),
          visitor_uid: visitor.visitor_uid,
          rfid_uid: visitor.rfid_uid || null,
          fullname: visitor.fullname,
          phone: visitor.phone,
          email: visitor.email,
          badgeNumber: visitor.badgeNumber,
          hostName: visitor.hostName,
          purpose: visitor.purpose,
          check_in_time: visitor.check_in_time,
          check_out_time: visitor.check_out_time,
        },
      };

      return buildResult(
        200,
        {
          success: true,
          valid: true,
          message: "Valid Visitor",
          ...validPayload,
        },
        validPayload,
      );
    }
  }

  if (!resident) {
    const invalidPayload = {
      valid: false,
      cardCode: cardCode || null,
      hardwareUid: hardwareUid || null,
      source,
      scannedAt,
      message: "Invalid RFID card",
    };

    return buildResult(
      404,
      {
        success: false,
        ...invalidPayload,
      },
      invalidPayload,
    );
  }

  const room = await findResidentRoom(resident);
  const validPayload = {
    valid: true,
    personType: "resident",
    matchType:
      hardwareUid && resident.rfid_uid === hardwareUid ? "hardwareUid" : "cardCode",
    cardCode: cardCode || null,
    hardwareUid: hardwareUid || null,
    source,
    scannedAt,
    resident: {
      id: String(resident._id),
      resident_uid: resident.resident_uid,
      rfid_uid: resident.rfid_uid || null,
      fullname: resident.fullname,
      role: resident.role,
      room_id: resident.room_id || null,
    },
    room: room
      ? {
        id: String(room._id),
        room_name: room.room_name,
        floor: room.floor,
        status: room.status,
      }
      : null,
  };

  return buildResult(
    200,
    {
      success: true,
      valid: true,
      message: "Valid Resident",
      ...validPayload,
    },
    validPayload,
  );
}

function emitRfidScan(io, payload) {
  io?.emit("rfid:scan", payload);
  io?.emit("rfid_scan", payload);
}

async function saveRfidScanLog(raw = {}, result = {}) {
  const payload = result.eventPayload || result.response || {};
  const response = result.response || payload;
  const scannedAt = payload.scannedAt ? new Date(payload.scannedAt) : new Date();

  const log = await RfidScanLog.create({
    valid: Boolean(payload.valid),
    message: response.message || payload.message,
    source: payload.source || raw.source || "rfid_scan",
    device_id: raw.device_id || raw.deviceId,
    cardCode: payload.cardCode || raw.cardCode || null,
    hardwareUid: normalizeRfidUid(
      payload.hardwareUid || raw.hardwareUid || raw.rfidUid || raw.rfid_uid,
    ),
    personType: payload.personType || null,
    matchType: payload.matchType || null,
    resident_id: objectIdOrUndefined(payload.resident?.id),
    visitor_id: objectIdOrUndefined(payload.visitor?.id),
    room_id: objectIdOrUndefined(payload.room?.id),
    response,
    raw,
    scanned_at: Number.isNaN(scannedAt.getTime()) ? new Date() : scannedAt,
  });

  return log.toObject();
}

module.exports = {
  emitRfidScan,
  normalizeRfidUid,
  saveRfidScanLog,
  validateRfidScan,
};
