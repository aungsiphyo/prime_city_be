const mqtt = require("mqtt");
const Parking = require("../models/Parking");
const ParkingEvent = require("../models/ParkingEvent");
const mongoose = require("mongoose");
const SosAlert = require("../models/SosAlert");
const Room = require("../models/Room");
const {
  emitRfidScan,
  saveRfidScanLog,
  validateRfidScan,
} = require("./rfidScan.service");

const TOPICS = {
  sosAlert: "sos/alert",
  parkingUpdate: "parking/update",
  rfidScan: "rfid/scan",
  rfidScanResult: "rfid/scan/result",
};

function buildRfidDeviceResult(response = {}) {
  const residentName = response.resident?.fullname || "";
  const visitorName = response.visitor?.fullname || "";

  return {
    success: Boolean(response.success),
    valid: Boolean(response.valid),
    message: response.message || "",
    personType: response.personType || null,
    matchType: response.matchType || null,
    hardwareUid: response.hardwareUid || null,
    cardCode: response.cardCode || null,
    name: residentName || visitorName || null,
    roomName: response.room?.room_name || null,
    scannedAt: response.scannedAt || new Date().toISOString(),
  };
}

function isValidType(type) {
  return ["visitor", "resident"].includes(type);
}

async function updateParkingByDelta(type, delta, raw = {}) {
  if (!isValidType(type)) {
    throw new Error("Invalid parking type");
  }

  if (![1, -1].includes(delta)) {
    throw new Error("delta must be 1 or -1");
  }

  const parking = await Parking.findOne({ type });

  if (!parking) {
    throw new Error(`${type} parking setup not found`);
  }

  const previousUsedSlot = parking.usedSlot;
  const previousAvailableSlot = parking.availableSlot;
  const usableSlot = Math.max(parking.totalSlot - parking.maintenanceSlot, 0);

  let newUsedSlot = parking.usedSlot + delta;

  if (newUsedSlot < 0) newUsedSlot = 0;
  if (newUsedSlot > usableSlot) newUsedSlot = usableSlot;

  parking.usedSlot = newUsedSlot;
  parking.availableSlot = Math.max(usableSlot - newUsedSlot, 0);

  await parking.save();

  const event = await ParkingEvent.create({
    type,
    delta,
    source: raw.source || "ESP32",
    device_id: raw.device_id || raw.deviceId,
    previousUsedSlot,
    usedSlot: parking.usedSlot,
    previousAvailableSlot,
    availableSlot: parking.availableSlot,
    totalSlot: parking.totalSlot,
    maintenanceSlot: parking.maintenanceSlot,
    raw,
    created_at: new Date(),
  });

  return { parking, event };
}

function setupMQTT(io) {
  const client = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    reconnectPeriod: 3000,
    keepalive: 60,
    clean: true,
  });

  client.on("connect", () => {
    console.log("✅ MQTT Connected");

    client.subscribe(TOPICS.sosAlert);
    client.subscribe(TOPICS.parkingUpdate);
    client.subscribe(TOPICS.rfidScan);

    console.log(`📡 Subscribed: ${TOPICS.sosAlert}`);
    console.log(`📡 Subscribed: ${TOPICS.parkingUpdate}`);
    console.log(`📡 Subscribed: ${TOPICS.rfidScan}`);
  });

  client.on("message", async (topic, message) => {
    try {
      const data = JSON.parse(message.toString());

      console.log("MQTT:", topic, data);

      if (topic === TOPICS.sosAlert) {
        const sosData = {
          message: data.message || "SOS alert received",
          source: data.source || "ESP32",
          status:
            data.status === "SOS_ACTIVE" ? "Pending" : data.status || "Pending",
          alert_type: data.alert_type || "General",
          priority: data.priority || "High",
          device_id: data.device_id,
          created_at: new Date(),
        };

        if (data.room_id) sosData.room_id = data.room_id;
        // If MQTT provided a room identifier that's not an ObjectId (like room name), resolve it to _id
        if (
          sosData.room_id &&
          !mongoose.Types.ObjectId.isValid(String(sosData.room_id))
        ) {
          const lookup = String(sosData.room_id || "").trim();
          const linkedRoom = await Room.findOne({
            $or: [{ room_name: lookup }, { room_id: lookup }],
          });
          if (linkedRoom) {
            sosData.room_id = String(linkedRoom._id);
          }
        }
        if (data.resident_id) sosData.resident_id = data.resident_id;

        const createdAlert = await SosAlert.create(sosData);
        const populatedAlert = await SosAlert.findById(createdAlert._id)
          .populate("resident_id", "fullname email phone role")
          .populate("room_id")
          .lean();

        io.emit("sos_alert", populatedAlert);
        io.emit("sos_alert_created", populatedAlert);
        io.emit("admin_sos_alert", populatedAlert);
      }

      if (topic === TOPICS.parkingUpdate) {
        const { parking: updatedParking, event } = await updateParkingByDelta(
          data.type,
          Number(data.delta),
          data,
        );

        console.log("✅ Parking Updated:", updatedParking);

        io.emit("parking_update", updatedParking);
        io.emit("parking_event", event);
      }

      if (topic === TOPICS.rfidScan) {
        const result = await validateRfidScan(data);
        const log = await saveRfidScanLog(data, result);

        emitRfidScan(io, result.eventPayload);
        io.emit("rfid_scan_log", log);

        const responseTopic = data.responseTopic || TOPICS.rfidScanResult;
        const deviceResult = buildRfidDeviceResult(result.response);
        const devicePayload = JSON.stringify(deviceResult);

        client.publish(responseTopic, devicePayload, (publishErr) => {
          if (publishErr) {
            console.error("❌ RFID result publish failed:", publishErr.message);
            return;
          }

          console.log("📤 RFID result published:", responseTopic, deviceResult);
        });

        console.log("✅ RFID Scan Processed:", result.response);
      }
    } catch (err) {
      console.error("❌ MQTT Error:", err.message);
    }
  });

  client.on("error", (err) => {
    console.error("❌ MQTT Client Error:", err.message);
  });

  client.on("close", () => {
    console.log("⚠️ MQTT Disconnected");
  });

  return client;
}

module.exports = setupMQTT;
