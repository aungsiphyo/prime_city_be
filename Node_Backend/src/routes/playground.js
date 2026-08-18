const express = require("express");
const mongoose = require("mongoose");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const Notification = require("../models/Notification");
const PlaygroundRegistration = require("../models/PlaygroundRegistration");
const RfidWallet = require("../models/RfidWallet");
const RfidWalletTransaction = require("../models/RfidWalletTransaction");
const User = require("../models/User");
const { resolveCurrentRoom } = require("../services/aiTools.service");
const {
  PLAYGROUND_TIME_SLOTS,
  getPlaygroundConfig,
} = require("../services/communityCatalog.service");
const { sendPushToUser } = require("../services/push.service");
const { recordAdminAudit } = require("../services/audit.service");

const router = express.Router();

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function emitNotification(app, userId, notification) {
  const io = app.get("io");
  const socketIds = (app.get("onlineUsers") || {})[String(userId)];
  if (io && socketIds) {
    io.to(Array.isArray(socketIds) ? socketIds : [socketIds]).emit(
      "notification",
      notification,
    );
  }
}

function parseRequestedDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function getCurrentResident(req) {
  return User.findById(getUserId(req))
    .select("_id fullname phone role room_id rfid_uid card_status")
    .lean();
}

router.get("/config", protect, (_req, res) => {
  res.json({ success: true, data: getPlaygroundConfig() });
});

router.get("/registrations", protect, async (req, res) => {
  try {
    const user = await getCurrentResident(req);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const manager = ["Admin", "Staff"].includes(user.role);
    const filter = manager ? {} : { user_id: user._id };
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const registrations = await PlaygroundRegistration.find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .populate("room_id", "room_name building floor")
      .populate("user_id", manager ? "fullname phone role" : "fullname role")
      .lean();
    return res.json({ success: true, data: registrations });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post(
  "/registrations",
  protect,
  authorizeRoles("Resident", "Citizen"),
  async (req, res) => {
    const childName = String(req.body.child_name || "").trim();
    const childAge = Number(req.body.child_age);
    const requestedDate = parseRequestedDate(req.body.requested_date);
    const timeSlot = String(req.body.time_slot || "").trim();
    const notes = String(req.body.notes || "").trim();
    const requestedPaymentMethod = String(req.body.payment_method || "Pay at desk").trim();

    if (!childName || childName.length > 100) {
      return res.status(400).json({ success: false, message: "Child name is required" });
    }
    if (!Number.isInteger(childAge) || childAge < 1 || childAge > 17) {
      return res.status(400).json({ success: false, message: "Child age must be between 1 and 17" });
    }
    if (!requestedDate || requestedDate < startOfTodayUtc()) {
      return res.status(400).json({ success: false, message: "Choose today or a future date" });
    }
    if (!PLAYGROUND_TIME_SLOTS.includes(timeSlot)) {
      return res.status(400).json({ success: false, message: "Choose a valid playground time slot" });
    }
    if (notes.length > 500) {
      return res.status(400).json({ success: false, message: "Notes must be 500 characters or fewer" });
    }

    const user = await getCurrentResident(req);
    const resolved = user ? await resolveCurrentRoom(user) : { found: false };
    if (!user || !resolved.found) {
      return res.status(403).json({
        success: false,
        message: "Your resident account must be linked to a room",
      });
    }

    const duplicate = await PlaygroundRegistration.exists({
      user_id: user._id,
      child_name: new RegExp(`^${childName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      requested_date: requestedDate,
      time_slot: timeSlot,
      status: { $in: ["Pending", "Confirmed", "Waitlisted"] },
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "This child already has an active registration for that session",
      });
    }

    const config = getPlaygroundConfig();
    const amountDue = config.discounted_fee_mmk;
    const paymentMethod =
      config.pricing_configured && amountDue === 0
        ? "Not required"
        : config.pricing_configured && requestedPaymentMethod === "RFID Wallet"
          ? "RFID Wallet"
          : "Pay at desk";
    const registrationId = new mongoose.Types.ObjectId();
    const session = await mongoose.startSession();
    let registration;

    try {
      await session.withTransaction(async () => {
        let paymentStatus =
          config.pricing_configured && amountDue === 0
            ? "Not Required"
            : "Pending";
        let paymentTransactionId = null;

        if (
          config.pricing_configured &&
          amountDue > 0 &&
          paymentMethod === "RFID Wallet"
        ) {
          if (!user.rfid_uid || ["lost", "suspended"].includes(user.card_status)) {
            const error = new Error("An active RFID card is required for wallet payment");
            error.status = 409;
            throw error;
          }
          const wallet = await RfidWallet.findOne({
            user_id: user._id,
            status: "Active",
          }).session(session);
          if (!wallet || wallet.balance_mmk < amountDue) {
            const error = new Error("Insufficient RFID wallet balance");
            error.status = 409;
            throw error;
          }
          wallet.balance_mmk -= amountDue;
          await wallet.save({ session });
          const [transaction] = await RfidWalletTransaction.create(
            [
              {
                wallet_id: wallet._id,
                user_id: user._id,
                type: "Payment",
                amount_mmk: amountDue,
                balance_after_mmk: wallet.balance_mmk,
                description: `Playground registration for ${childName}`,
                reference_type: "PlaygroundRegistration",
                reference_id: registrationId,
                created_by: user._id,
              },
            ],
            { session },
          );
          paymentStatus = "Paid";
          paymentTransactionId = transaction._id;
        }

        [registration] = await PlaygroundRegistration.create(
          [
            {
              _id: registrationId,
              user_id: user._id,
              room_id: resolved.room._id,
              child_name: childName,
              child_age: childAge,
              requested_date: requestedDate,
              time_slot: timeSlot,
              guardian_phone: user.phone,
              notes,
              base_fee_mmk: config.base_fee_mmk,
              resident_discount_percent: config.resident_discount_percent,
              amount_due_mmk: amountDue,
              pricing_status: config.pricing_configured
                ? "Final"
                : "Admin Confirmation",
              payment_method: paymentMethod,
              payment_status: paymentStatus,
              payment_transaction_id: paymentTransactionId,
            },
          ],
          { session },
        );
      });

      return res.status(201).json({
        success: true,
        message: "Playground registration submitted",
        data: registration,
      });
    } catch (error) {
      return res.status(error.status || 500).json({
        success: false,
        message: error.message,
      });
    } finally {
      await session.endSession();
    }
  },
);

router.patch(
  "/registrations/:id/status",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
    const status = String(req.body.status || "").trim();
    const adminNote = String(req.body.admin_note || "").trim();
    if (!["Confirmed", "Waitlisted", "Completed", "Cancelled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid registration status" });
    }

    const session = await mongoose.startSession();
    try {
      let registration;
      await session.withTransaction(async () => {
        registration = await PlaygroundRegistration.findById(req.params.id)
          .populate("room_id", "room_name")
          .session(session);
        if (!registration) {
          const error = new Error("Registration not found");
          error.status = 404;
          throw error;
        }
        if (registration.status === "Cancelled" && status !== "Cancelled") {
          const error = new Error("A cancelled registration cannot be reopened");
          error.status = 409;
          throw error;
        }

        if (
          status === "Cancelled" &&
          registration.status !== "Cancelled" &&
          registration.payment_method === "RFID Wallet" &&
          registration.payment_status === "Paid"
        ) {
          const wallet = await RfidWallet.findOne({ user_id: registration.user_id }).session(session);
          if (!wallet) {
            const error = new Error("RFID wallet was not found for refund");
            error.status = 409;
            throw error;
          }
          wallet.balance_mmk += registration.amount_due_mmk;
          await wallet.save({ session });
          await RfidWalletTransaction.create(
            [
              {
                wallet_id: wallet._id,
                user_id: registration.user_id,
                type: "Refund",
                amount_mmk: registration.amount_due_mmk,
                balance_after_mmk: wallet.balance_mmk,
                description: `Playground cancellation refund for ${registration.child_name}`,
                reference_type: "PlaygroundRegistration",
                reference_id: registration._id,
                created_by: getUserId(req),
              },
            ],
            { session },
          );
          registration.payment_status = "Refunded";
        }

        registration.status = status;
        registration.admin_note = adminNote;
        registration.reviewed_by = getUserId(req);
        registration.reviewed_at = new Date();
        await registration.save({ session });
      });

      const notification = await Notification.create({
        user_id: registration.user_id,
        title: "Playground registration updated",
        message: `${registration.child_name}'s playground registration is ${status}.`,
        type: "General",
        data: {
          playground_registration_id: String(registration._id),
          status,
          room_name: registration.room_id?.room_name || "",
        },
      });
      emitNotification(req.app, registration.user_id, notification);
      try {
        await sendPushToUser(registration.user_id, {
          title: notification.title,
          message: notification.message,
          type: notification.type,
          data: notification.data,
          notification_id: String(notification._id),
        });
      } catch (pushError) {
        console.error("Playground status push failed:", pushError.message);
      }
      await recordAdminAudit({
        adminUserId: getUserId(req),
        action: "PLAYGROUND_REGISTRATION_STATUS_UPDATED",
        entityType: "PlaygroundRegistration",
        entityId: registration._id,
        metadata: { status },
      });

      return res.json({ success: true, data: registration });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, message: error.message });
    } finally {
      await session.endSession();
    }
  },
);

module.exports = router;
