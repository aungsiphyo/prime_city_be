const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const BillPaymentSubmission = require("../models/BillPaymentSubmission");
const Notification = require("../models/Notification");
const ServiceBill = require("../models/ServiceBill");
const User = require("../models/User");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { resolveCurrentRoom } = require("../services/aiTools.service");
const { recordAdminAudit } = require("../services/audit.service");
const {
  amountsMatch,
  canSubmitPaymentForBill,
} = require("../services/billing.service");
const { sendPushToUser, sendPushToUsers } = require("../services/push.service");

const router = express.Router();
const PAYMENT_PROOF_DIR = path.resolve(
  process.env.PAYMENT_PROOF_DIR ||
    path.join(__dirname, "../../private/uploads/payment-proofs"),
);
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return callback(new Error("Only JPEG, PNG or WebP screenshots are allowed"));
    }
    return callback(null, true);
  },
});

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function isManager(role) {
  return ["Admin", "Staff"].includes(role);
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function extensionForMime(mime) {
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return ".jpg";
}

function serializeSubmission(submission) {
  const item = submission?.toObject ? submission.toObject() : { ...submission };
  delete item.screenshot_path;
  delete item.screenshot_mime;
  delete item.screenshot_size;

  return {
    ...item,
    proof_url: item._id ? `/bill-payments/${item._id}/proof` : null,
  };
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

async function notifyManagers(app, submission, bill, resident) {
  const managers = await User.find({ role: { $in: ["Admin", "Staff"] } })
    .select("_id")
    .lean();
  const managerIds = managers.map((item) => item._id);
  if (!managerIds.length) return;

  const roomName = bill.room_id?.room_name || "Unknown room";
  const title = "Bill payment submitted";
  const message = `${resident.fullname || "Resident"} from Room ${roomName} submitted a KPay payment screenshot for ${bill.amount} MMK.`;
  const data = {
    payment_submission_id: String(submission._id),
    bill_id: String(bill._id),
    resident_id: String(resident._id),
    room_id: String(bill.room_id?._id || bill.room_id),
    room_name: roomName,
    expected_amount: String(bill.amount),
  };
  const notifications = await Notification.insertMany(
    managerIds.map((managerId) => ({
      user_id: managerId,
      title,
      message,
      type: "General",
      data,
    })),
  );

  notifications.forEach((notification) => {
    emitNotificationToUser(app, notification.user_id, notification);
  });
  await sendPushToUsers(managerIds, { title, message, type: "General", data });
}

async function notifyResident(app, submission, bill, action) {
  const approved = action === "approve";
  const title = approved ? "Bill payment approved" : "Bill payment update";
  const message = approved
    ? `Your ${bill.title} payment of ${bill.amount} MMK has been approved.`
    : action === "resubmission"
      ? `Please resubmit the payment screenshot for ${bill.title}. ${submission.rejection_reason || submission.admin_note || "Check the screenshot and exact amount."}`
      : `Your payment submission for ${bill.title} was rejected. ${submission.rejection_reason || submission.admin_note || "Please contact management for details."}`;
  const data = {
    payment_submission_id: String(submission._id),
    bill_id: String(bill._id),
    payment_status: submission.status,
    bill_status: bill.status,
  };
  const notification = await Notification.create({
    user_id: submission.user_id,
    title,
    message,
    type: "General",
    data,
  });

  emitNotificationToUser(app, submission.user_id, notification);
  await sendPushToUser(submission.user_id, {
    title,
    message,
    type: "General",
    data,
    notification_id: String(notification._id),
  });
}

async function getCurrentUser(req) {
  return User.findById(getUserId(req)).select("_id fullname role room_id").lean();
}

function canAccessPaymentProof({ currentUser, submission, roomId }) {
  if (!currentUser || !submission) return false;
  if (isManager(currentUser.role)) return true;

  return (
    String(submission.user_id) === String(currentUser._id) &&
    String(submission.room_id) === String(roomId)
  );
}

router.post(
  "/:billId/submit",
  protect,
  authorizeRoles("Resident", "Citizen"),
  upload.single("screenshot"),
  async (req, res) => {
    let savedPath = null;
    let dbSession = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "A KPay payment screenshot is required",
        });
      }

      const detectedMime = detectImageMime(req.file.buffer);
      if (!detectedMime || detectedMime !== req.file.mimetype) {
        return res.status(400).json({
          success: false,
          message: "The uploaded file is not a valid payment screenshot image",
        });
      }

      const currentUser = await getCurrentUser(req);
      if (!currentUser) {
        return res.status(401).json({ success: false, message: "User not found" });
      }
      const resolved = await resolveCurrentRoom(currentUser);
      if (!resolved.found) {
        return res.status(403).json({
          success: false,
          message: "Your account is not linked to a room",
        });
      }

      const bill = await ServiceBill.findOne({
        _id: req.params.billId,
        room_id: resolved.room._id,
      }).populate("room_id", "room_name building floor");
      if (!bill) {
        return res.status(404).json({ success: false, message: "Bill not found" });
      }
      if (!canSubmitPaymentForBill(bill.status)) {
        return res.status(409).json({
          success: false,
          message: `A payment cannot be submitted while the bill is ${bill.status}`,
        });
      }

      if (!amountsMatch(bill.amount, req.body.submitted_amount)) {
        return res.status(400).json({
          success: false,
          message: `The submitted amount must exactly match ${bill.amount} MMK`,
        });
      }

      const activeSubmission = await BillPaymentSubmission.exists({
        bill_id: bill._id,
        is_active: true,
      });
      if (activeSubmission) {
        return res.status(409).json({
          success: false,
          message: "This bill already has a payment awaiting review",
        });
      }

      await fs.mkdir(PAYMENT_PROOF_DIR, { recursive: true, mode: 0o700 });
      const fileName = `${crypto.randomUUID()}${extensionForMime(detectedMime)}`;
      savedPath = path.join(PAYMENT_PROOF_DIR, fileName);
      await fs.writeFile(savedPath, req.file.buffer, { flag: "wx", mode: 0o600 });

      let submission;
      dbSession = await mongoose.startSession();
      await dbSession.withTransaction(async () => {
        [submission] = await BillPaymentSubmission.create(
          [
            {
              bill_id: bill._id,
              user_id: currentUser._id,
              room_id: resolved.room._id,
              expected_amount: bill.amount,
              submitted_amount: Number(req.body.submitted_amount),
              screenshot_path: savedPath,
              screenshot_mime: detectedMime,
              screenshot_size: req.file.size,
              user_note: req.body.user_note || "",
            },
          ],
          { session: dbSession },
        );
        const update = await ServiceBill.updateOne(
          { _id: bill._id, status: bill.status },
          {
            $set: {
              status: "Payment Submitted",
              resident_user_id: currentUser._id,
            },
          },
          { session: dbSession },
        );
        if (update.modifiedCount !== 1) {
          const error = new Error("Bill status changed before payment submission");
          error.status = 409;
          throw error;
        }
      });
      await dbSession.endSession();
      dbSession = null;
      bill.status = "Payment Submitted";
      bill.resident_user_id = currentUser._id;

      // The private proof is now referenced by a committed database record.
      // A notification outage must not delete it or make the client retry.
      savedPath = null;
      let notificationDelivery = { success: true };
      try {
        await notifyManagers(req.app, submission, bill, currentUser);
      } catch (notificationError) {
        console.error("Payment submission notification failed:", notificationError.message);
        notificationDelivery = { success: false };
      }
      return res.status(201).json({
        success: true,
        message: "Payment submitted for Admin verification",
        data: serializeSubmission(submission),
        notification_delivery: notificationDelivery,
      });
    } catch (err) {
      if (dbSession) await dbSession.endSession().catch(() => {});
      if (savedPath) await fs.unlink(savedPath).catch(() => {});
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "This bill already has a payment awaiting review",
        });
      }
      return res
        .status(err.status || 500)
        .json({ success: false, message: err.message });
    }
  },
);

router.get("/mine", protect, authorizeRoles("Resident", "Citizen"), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const filter = { user_id: getUserId(req) };
    const [items, total] = await Promise.all([
      BillPaymentSubmission.find(filter)
        .sort({ submitted_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("bill_id", "title amount status due_date billing_month billing_year")
        .populate("room_id", "room_name building floor")
        .lean(),
      BillPaymentSubmission.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items.map(serializeSubmission),
      pagination: { total, page, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [items, total] = await Promise.all([
      BillPaymentSubmission.find(filter)
        .sort({ submitted_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("bill_id", "title amount status due_date billing_month billing_year")
        .populate("user_id", "fullname email phone resident_uid")
        .populate("room_id", "room_name building floor")
        .populate("reviewed_by", "fullname role")
        .lean(),
      BillPaymentSubmission.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items.map(serializeSubmission),
      pagination: { total, page, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id/proof", protect, async (req, res) => {
  try {
    const [currentUser, submission] = await Promise.all([
      getCurrentUser(req),
      BillPaymentSubmission.findById(req.params.id).select(
        "+screenshot_path +screenshot_mime +screenshot_size",
      ),
    ]);
    if (!currentUser || !submission) {
      return res.status(404).json({ success: false, message: "Payment proof not found" });
    }

    let roomId = null;
    if (!isManager(currentUser.role)) {
      const resolved = await resolveCurrentRoom(currentUser);
      roomId = resolved.found ? resolved.room._id : null;
    }
    if (!canAccessPaymentProof({ currentUser, submission, roomId })) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.setHeader("Content-Type", submission.screenshot_mime);
    res.setHeader("Content-Length", String(submission.screenshot_size));
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Content-Disposition", "inline; filename=payment-proof");
    return res.sendFile(path.resolve(submission.screenshot_path));
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post(
  "/:id/review",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
    const action = String(req.body.action || "").trim().toLowerCase();
    if (!["under_review", "approve", "reject", "resubmission"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "action must be under_review, approve, reject or resubmission",
      });
    }

    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        const submission = await BillPaymentSubmission.findOne({
          _id: req.params.id,
          is_active: true,
          status: { $in: ["Pending", "Under Review"] },
        }).session(session);
        if (!submission) {
          const error = new Error("Payment is not pending review");
          error.status = 409;
          throw error;
        }

        const bill = await ServiceBill.findById(submission.bill_id).session(session);
        if (!bill) {
          const error = new Error("Bill not found");
          error.status = 404;
          throw error;
        }
        if (
          action === "approve" &&
          (!amountsMatch(bill.amount, submission.expected_amount) ||
            !amountsMatch(bill.amount, submission.submitted_amount))
        ) {
          const error = new Error("Payment amount no longer matches the bill total");
          error.status = 409;
          throw error;
        }

        if (action === "under_review") {
          submission.status = "Under Review";
          bill.status = "Under Review";
        } else {
          submission.is_active = false;
          submission.reviewed_at = new Date();
          submission.reviewed_by = getUserId(req);
          submission.admin_note = req.body.admin_note || "";

          if (action === "approve") {
            if (bill.status === "Paid") {
              const error = new Error("Bill is already paid");
              error.status = 409;
              throw error;
            }
            submission.status = "Approved";
            bill.status = "Paid";
            bill.paid_at = new Date();
            bill.approved_by = getUserId(req);
            bill.payment_method = "KPay manual transfer";
            bill.transaction_id = String(submission._id);
          } else {
            submission.status =
              action === "resubmission" ? "Resubmission Required" : "Rejected";
            submission.rejection_reason = String(req.body.reason || "").trim();
            bill.status = "Rejected";
            bill.paid_at = null;
            bill.approved_by = null;
            bill.payment_method = "";
            bill.transaction_id = "";
          }
        }

        await submission.save({ session });
        await bill.save({ session });
        result = { submission, bill };
      });

      let notificationDelivery = { success: true };
      if (action !== "under_review") {
        try {
          await notifyResident(req.app, result.submission, result.bill, action);
        } catch (notificationError) {
          console.error("Payment review notification failed:", notificationError.message);
          notificationDelivery = { success: false };
        }
      }
      await recordAdminAudit({
        adminUserId: getUserId(req),
        action: `bill_payment_${action}`,
        entityType: "BillPaymentSubmission",
        entityId: result.submission._id,
        metadata: {
          billId: String(result.bill._id),
          residentUserId: String(result.submission.user_id),
          amount: result.submission.submitted_amount,
        },
      });

      return res.json({
        success: true,
        message: action === "approve" ? "Payment approved and bill marked Paid" : "Payment updated",
        data: serializeSubmission(result.submission),
        bill: result.bill,
        notification_delivery: notificationDelivery,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, message: err.message });
    } finally {
      await session.endSession();
    }
  },
);

router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: err.code === "LIMIT_FILE_SIZE" ? "Screenshot must be 5 MB or smaller" : err.message,
    });
  }
  return res.status(400).json({ success: false, message: err.message });
});

module.exports = router;
module.exports.canAccessPaymentProof = canAccessPaymentProof;
module.exports.detectImageMime = detectImageMime;
