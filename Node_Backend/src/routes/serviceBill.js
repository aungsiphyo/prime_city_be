const express = require("express");
const router = express.Router();
const BillPaymentSubmission = require("../models/BillPaymentSubmission");
const Notification = require("../models/Notification");
const ServiceBill = require("../models/ServiceBill");
const User = require("../models/User");
const Room = require("../models/Room");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { resolveCurrentRoom } = require("../services/aiTools.service");
const { recordAdminAudit } = require("../services/audit.service");
const {
  COMPONENT_FIELDS,
  buildBillingKey,
  calculateBillTotal,
  normalizeMoney,
} = require("../services/billing.service");
const { sendPushToUser } = require("../services/push.service");

const MANUAL_STATUS_FIELDS = new Set(["Pending", "Overdue"]);

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function populateBillRoom(query) {
  return query
    .populate({
      path: "room_id",
      select: "room_name building floor room_type status owner_name resident_id",
      populate: {
        path: "resident_id",
        select: "fullname email phone role resident_uid",
      },
    })
    .populate("approved_by", "fullname role")
    .populate("created_by", "fullname role");
}

function emitNotificationToUser(app, userId, notification) {
  const io = app.get("io");
  const onlineUsers = app.get("onlineUsers") || {};
  const socketIds = onlineUsers[String(userId)];

  if (io && socketIds) {
    io.to(Array.isArray(socketIds) ? socketIds : [socketIds]).emit(
      "notification",
      notification,
    );
  }
}

function serializePayment(submission) {
  if (!submission) return null;
  return {
    ...submission,
    proof_url: `/bill-payments/${submission._id}/proof`,
  };
}

async function attachLatestPayments(bills, currentUser) {
  const ids = bills.map((bill) => bill._id);
  if (!ids.length) return bills;

  const filter = { bill_id: { $in: ids } };
  if (!["Admin", "Staff"].includes(currentUser.role)) {
    filter.user_id = currentUser._id;
  }
  const submissions = await BillPaymentSubmission.find(filter)
    .sort({ submitted_at: -1 })
    .populate("user_id", "fullname phone resident_uid")
    .populate("reviewed_by", "fullname role")
    .lean();
  const latestByBill = new Map();
  submissions.forEach((submission) => {
    const billId = String(submission.bill_id);
    if (!latestByBill.has(billId)) latestByBill.set(billId, submission);
  });

  return bills.map((bill) => ({
    ...bill,
    latest_payment: serializePayment(latestByBill.get(String(bill._id))),
  }));
}

function parseDate(value, fieldName) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    const error = new Error(`${fieldName} must be a valid date`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function buildBillPayload(body, room, existingBill = null) {
  const payload = {};
  const hasAnyComponentField = COMPONENT_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );

  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    payload.title = String(body.title || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "type")) {
    payload.type = String(body.type || "General").trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "other_description")) {
    payload.other_description = String(body.other_description || "").trim();
  }

  COMPONENT_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(body, field)) return;
    const value = normalizeMoney(body[field]);
    if (value === null) {
      const error = new Error(`${field} must be a non-negative number`);
      error.status = 400;
      throw error;
    }
    payload[field] = value;
  });

  if (hasAnyComponentField) {
    payload.amount = calculateBillTotal({
      ...(existingBill?.toObject ? existingBill.toObject() : existingBill || {}),
      ...payload,
    });
  } else if (Object.prototype.hasOwnProperty.call(body, "amount")) {
    payload.amount = normalizeMoney(body.amount);
  }

  if (payload.amount === null || (!existingBill && !(payload.amount > 0))) {
    const error = new Error("Bill amount must be greater than zero");
    error.status = 400;
    throw error;
  }
  if (Object.prototype.hasOwnProperty.call(body, "due_date")) {
    payload.due_date = parseDate(body.due_date, "due_date");
  } else if (!existingBill) {
    const error = new Error("due_date is required");
    error.status = 400;
    throw error;
  }

  const month = Object.prototype.hasOwnProperty.call(body, "billing_month")
    ? Number(body.billing_month)
    : existingBill?.billing_month;
  const year = Object.prototype.hasOwnProperty.call(body, "billing_year")
    ? Number(body.billing_year)
    : existingBill?.billing_year;
  if ((month && !year) || (!month && year)) {
    const error = new Error("billing_month and billing_year must be provided together");
    error.status = 400;
    throw error;
  }
  if (month || year) {
    const billingKey = buildBillingKey(room._id, year, month);
    if (!billingKey) {
      const error = new Error("billing_month or billing_year is invalid");
      error.status = 400;
      throw error;
    }
    payload.billing_month = month;
    payload.billing_year = year;
    payload.billing_key = billingKey;
    if (!payload.title && !existingBill?.title) {
      const monthName = new Intl.DateTimeFormat("en", { month: "long" }).format(
        new Date(Date.UTC(year, month - 1, 1)),
      );
      payload.title = `${monthName} ${year} Monthly Bill`;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (!MANUAL_STATUS_FIELDS.has(body.status)) {
      const error = new Error(
        "Payment status is managed by the payment verification workflow",
      );
      error.status = 400;
      throw error;
    }
    payload.status = body.status;
  }

  return payload;
}

async function getCurrentUser(req) {
  return User.findById(getUserId(req)).select("_id role room_id").lean();
}

async function notifyResidentOfBill(app, bill, residentId) {
  if (!residentId) return;
  const title = "New monthly bill";
  const message = `${bill.title}: ${bill.amount} MMK is due on ${new Date(
    bill.due_date,
  ).toLocaleDateString("en-GB")}.`;
  const data = { bill_id: String(bill._id), bill_status: bill.status };
  const notification = await Notification.create({
    user_id: residentId,
    title,
    message,
    type: "General",
    data,
  });
  emitNotificationToUser(app, residentId, notification);
  await sendPushToUser(residentId, {
    title,
    message,
    type: "General",
    data,
    notification_id: String(notification._id),
  });
}

router.get("/admin/rooms", protect, authorizeRoles("Admin", "Staff"), async (_req, res) => {
  try {
    const rooms = await Room.find({ resident_id: { $ne: null } })
      .select("room_name building floor room_type status resident_id")
      .populate("resident_id", "fullname email phone resident_uid")
      .sort({ building: 1, floor: 1, room_name: 1 })
      .lean();
    return res.json({ success: true, data: rooms });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/", protect, async (req, res) => {
  try {
    const currentUser = await getCurrentUser(req);

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user account was not found",
      });
    }

    const filter = {};
    const canViewAllBills = ["Admin", "Staff"].includes(currentUser.role);

    if (!canViewAllBills) {
      const resolved = await resolveCurrentRoom(currentUser);

      if (!resolved.found) {
        return res.json({
          success: true,
          scope: "own_room",
          room: null,
          data: [],
        });
      }

      filter.room_id = resolved.room._id;
    }

    const bills = await populateBillRoom(
      ServiceBill.find(filter).sort({ due_date: -1, created_at: -1 }),
    ).lean();
    const data = await attachLatestPayments(bills, currentUser);

    return res.json({
      success: true,
      scope: canViewAllBills ? "all_rooms" : "own_room",
      data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", protect, async (req, res) => {
  try {
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: "User not found" });
    }
    const filter = { _id: req.params.id };
    if (!["Admin", "Staff"].includes(currentUser.role)) {
      const resolved = await resolveCurrentRoom(currentUser);
      if (!resolved.found) {
        return res.status(404).json({ success: false, message: "Bill not found" });
      }
      filter.room_id = resolved.room._id;
    }

    const bill = await populateBillRoom(ServiceBill.findOne(filter)).lean();
    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found" });
    }
    const [data] = await attachLatestPayments([bill], currentUser);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    const room = await Room.findById(req.body.room_id)
      .select("_id room_name resident_id")
      .lean();
    if (!room) {
      return res.status(400).json({
        success: false,
        message: "A valid room_id is required",
      });
    }

    const payload = buildBillPayload(req.body, room);
    const bill = await ServiceBill.create({
      ...payload,
      room_id: room._id,
      resident_user_id: room.resident_id || null,
      created_by: getUserId(req),
      status: "Pending",
    });
    const populatedBill = await populateBillRoom(
      ServiceBill.findById(bill._id),
    ).lean();

    const io = req.app.get("io");
    if (io) io.emit("bill_update", populatedBill);

    let notificationDelivery = { success: true };
    try {
      await notifyResidentOfBill(req.app, bill, room.resident_id);
    } catch (notificationError) {
      console.error("New bill notification failed:", notificationError.message);
      notificationDelivery = { success: false };
    }
    await recordAdminAudit({
      adminUserId: getUserId(req),
      action: "monthly_bill_created",
      entityType: "ServiceBill",
      entityId: bill._id,
      metadata: { roomId: String(room._id), amount: bill.amount },
    });

    return res.status(201).json({
      success: true,
      message: "Bill created",
      bill: populatedBill,
      notification_delivery: notificationDelivery,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A monthly bill already exists for this room and month",
      });
    }
    return res
      .status(err.status || 500)
      .json({ success: false, message: err.message });
  }
});

router.put("/:id", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    const existingBill = await ServiceBill.findById(req.params.id);
    if (!existingBill) {
      return res.status(404).json({ success: false, message: "Bill not found" });
    }
    if (existingBill.status === "Paid") {
      return res.status(409).json({
        success: false,
        message: "A paid bill cannot be edited",
      });
    }
    if (
      req.body.room_id &&
      String(req.body.room_id) !== String(existingBill.room_id)
    ) {
      return res.status(400).json({
        success: false,
        message: "A bill cannot be moved to another room",
      });
    }
    const room = await Room.findById(existingBill.room_id)
      .select("_id resident_id")
      .lean();
    if (!room) {
      return res.status(409).json({
        success: false,
        message: "Bill room no longer exists",
      });
    }

    const payload = buildBillPayload(req.body, room, existingBill);
    Object.assign(existingBill, payload, {
      resident_user_id: room.resident_id || null,
    });
    await existingBill.save();

    const populatedBill = await populateBillRoom(
      ServiceBill.findById(existingBill._id),
    ).lean();

    const io = req.app.get("io");
    if (io) io.emit("bill_update", populatedBill);

    await recordAdminAudit({
      adminUserId: getUserId(req),
      action: "bill_updated",
      entityType: "ServiceBill",
      entityId: existingBill._id,
      metadata: { amount: existingBill.amount, status: existingBill.status },
    });

    return res.json({
      success: true,
      message: "Bill updated",
      bill: populatedBill,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A monthly bill already exists for this room and month",
      });
    }
    return res
      .status(err.status || 500)
      .json({ success: false, message: err.message });
  }
});

module.exports = router;
