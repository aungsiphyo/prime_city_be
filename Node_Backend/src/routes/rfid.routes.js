const express = require("express");
const RfidScanLog = require("../models/RfidScanLog");
const {
  emitRfidScan,
  saveRfidScanLog,
  validateRfidScan,
} = require("../services/rfidScan.service");

const router = express.Router();

function requireDeviceSecret(req, res, next) {
  const expectedSecret = process.env.RFID_DEVICE_SECRET;

  if (!expectedSecret) return next();

  const providedSecret =
    req.headers["x-device-secret"] || req.body.deviceSecret || "";

  if (providedSecret !== expectedSecret) {
    return res.status(401).json({
      success: false,
      valid: false,
      message: "Invalid RFID device secret",
    });
  }

  return next();
}

router.get("/scans", async (req, res) => {
  try {
    const {
      valid,
      personType,
      hardwareUid,
      page = 1,
      limit = 50,
    } = req.query;
    const filter = {};

    if (valid === "true") filter.valid = true;
    if (valid === "false") filter.valid = false;
    if (personType) filter.personType = personType;
    if (hardwareUid) {
      filter.hardwareUid = String(hardwareUid)
        .replace(/[^a-fA-F0-9]/g, "")
        .toUpperCase();
    }

    const pageNumber = Math.max(Number(page), 1);
    const limitNumber = Math.max(Number(limit), 1);
    const skip = (pageNumber - 1) * limitNumber;

    const [logs, total] = await Promise.all([
      RfidScanLog.find(filter)
        .sort({ scanned_at: -1 })
        .skip(skip)
        .limit(limitNumber)
        .populate("resident_id", "fullname email phone role resident_uid rfid_uid")
        .populate("visitor_id", "fullname phone email visitor_uid rfid_uid")
        .populate("room_id")
        .lean(),
      RfidScanLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        pages: Math.ceil(total / limitNumber),
      },
    });
  } catch (err) {
    console.error("GET /api/rfid/scans error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch RFID scan logs",
    });
  }
});

router.post("/scan", requireDeviceSecret, async (req, res) => {
  try {
    const result = await validateRfidScan(req.body);
    const log = await saveRfidScanLog(req.body, result);

    emitRfidScan(req.app.get("io"), result.eventPayload);
    req.app.get("io")?.emit("rfid_scan_log", log);

    return res.status(result.statusCode).json(result.response);
  } catch (err) {
    console.error("POST /api/rfid/scan error:", err);
    return res.status(500).json({
      success: false,
      valid: false,
      message: err.message || "Failed to validate RFID card",
    });
  }
});

module.exports = router;
