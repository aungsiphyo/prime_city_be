const Notification = require("../models/Notification");
const User = require("../models/User");
const { sendPushToUsers } = require("./push.service");

const RESIDENT_ROLES = Object.freeze(["Resident", "Citizen"]);

function emitNotificationToUser(app, userId, notification) {
  const io = app.get("io");
  const users = app.get("onlineUsers") || {};
  const socketIds = users[String(userId)];

  if (io && socketIds) {
    io.to(Array.isArray(socketIds) ? socketIds : [socketIds]).emit(
      "notification",
      notification,
    );
  }
}

function getSosLocation(alert) {
  return (
    alert.room_label ||
    alert.room_id?.room_name ||
    alert.device_id ||
    "Unknown location"
  );
}

function buildApprovedEmergencyPayload(alert, approvedBy, approvedAt) {
  const location = getSosLocation(alert);
  const alertType = alert.alert_type || "General";

  return {
    title: `Verified emergency: ${alertType}`,
    message: `${alert.message} Location: ${location}.`,
    type: "Emergency",
    data: {
      event: "SOS_APPROVED",
      sos_id: String(alert._id),
      status: "Approved",
      alert_type: alertType,
      priority: alert.priority || "High",
      source: alert.source || "Unknown",
      device_id: alert.device_id || "",
      room_id: alert.room_id?._id
        ? String(alert.room_id._id)
        : alert.room_id
          ? String(alert.room_id)
          : "",
      room_label: location,
      approved_by: String(approvedBy),
      approved_at: approvedAt.toISOString(),
    },
  };
}

async function persistApprovedEmergencyNotifications(userIds, payload) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return [];

  const selector = {
    type: "Emergency",
    "data.event": payload.data.event,
    "data.sos_id": payload.data.sos_id,
  };

  await Notification.bulkWrite(
    ids.map((userId) => {
      const dedupeKey = `sos-approved:${payload.data.sos_id}:${userId}`;
      return {
        updateOne: {
          filter: { dedupe_key: dedupeKey },
          update: {
            $setOnInsert: {
              user_id: userId,
              title: payload.title,
              message: payload.message,
              type: payload.type,
              data: payload.data,
              dedupe_key: dedupeKey,
              action_status: "Submitted",
              actioned_at: new Date(payload.data.approved_at),
              actioned_by: payload.data.approved_by,
            },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );

  return Notification.find({
    user_id: { $in: ids },
    ...selector,
  });
}

function getBroadcastStatus(pushDelivery, recipientCount) {
  if (!recipientCount) return "Failed";
  if (!pushDelivery?.success) return "Partial";
  if (Number(pushDelivery.failureCount || 0) > 0) return "Partial";
  return "Sent";
}

async function broadcastApprovedSos(app, alert, approvedBy, approvedAt) {
  const residents = await User.find({ role: { $in: RESIDENT_ROLES } })
    .select("_id")
    .lean();
  const residentIds = residents.map((resident) => resident._id);
  const payload = buildApprovedEmergencyPayload(
    alert,
    approvedBy,
    approvedAt,
  );
  const notifications = await persistApprovedEmergencyNotifications(
    residentIds,
    payload,
  );

  notifications.forEach((notification) => {
    emitNotificationToUser(app, notification.user_id, notification);
  });

  const pushDelivery = await sendPushToUsers(residentIds, payload, {
    channelId: "urgent_alerts",
    priority: "high",
    androidPriority: "high",
  });

  return {
    broadcastStatus: getBroadcastStatus(pushDelivery, residentIds.length),
    notificationCount: notifications.length,
    pushDelivery,
    recipientCount: residentIds.length,
  };
}

module.exports = {
  RESIDENT_ROLES,
  broadcastApprovedSos,
  buildApprovedEmergencyPayload,
  emitNotificationToUser,
  getBroadcastStatus,
  getSosLocation,
  persistApprovedEmergencyNotifications,
};
