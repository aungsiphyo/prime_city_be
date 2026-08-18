const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const RfidWallet = require("../models/RfidWallet");
const RfidWalletTransaction = require("../models/RfidWalletTransaction");
const PrimeCityMerchant = require("../models/PrimeCityMerchant");
const MerchantSettlement = require("../models/MerchantSettlement");
const Notification = require("../models/Notification");
const User = require("../models/User");
const { recordAdminAudit } = require("../services/audit.service");
const { sendPushToUser } = require("../services/push.service");

const router = express.Router();

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function maskCardUid(value) {
  const uid = String(value || "");
  if (!uid) return null;
  if (uid.length <= 4) return `•••• ${uid}`;
  return `•••• •••• ${uid.slice(-4)}`;
}

function cardStatusFor(user) {
  if (!user?.rfid_uid) return "unassigned";
  return user.card_status === "lost" || user.card_status === "suspended"
    ? user.card_status
    : "active";
}

function createMerchantCode() {
  return `PCM-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function createPaymentReference() {
  return `PC-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

function emitNotification(app, userId, notification) {
  const io = app.get("io");
  const socketIds = (app.get("onlineUsers") || {})[String(userId)];
  if (io && socketIds) {
    io.to(Array.isArray(socketIds) ? socketIds : [socketIds]).emit(
      "notification",
      notification
    );
  }
}

function serializeMerchant(merchant, includeBalances = false) {
  const item = merchant?.toObject ? merchant.toObject() : { ...merchant };
  return {
    _id: item._id,
    merchant_code: item.merchant_code,
    name: item.name,
    location: item.location,
    description: item.description,
    status: item.status,
    payment_code: `PRIMECITY:MERCHANT:${item.merchant_code}`,
    ...(includeBalances
      ? {
          wallet_balance_mmk: item.wallet_balance_mmk,
          lifetime_sales_mmk: item.lifetime_sales_mmk,
        }
      : {}),
  };
}

async function getResident(userId) {
  return User.findById(userId)
    .select("_id fullname role room_id rfid_uid card_status")
    .lean();
}

async function getOrCreateWallet(userId) {
  return RfidWallet.findOneAndUpdate(
    { user_id: userId },
    { $setOnInsert: { user_id: userId, balance_mmk: 0, status: "Active" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
}

router.get(
  "/me",
  protect,
  authorizeRoles("Resident", "Citizen"),
  async (req, res) => {
    try {
      const user = await getResident(getUserId(req));
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const wallet = await getOrCreateWallet(user._id);
      const transactions = await RfidWalletTransaction.find({
        user_id: user._id,
      })
        .sort({ created_at: -1 })
        .limit(30)
        .populate("merchant_id", "merchant_code name location")
        .lean();

      return res.json({
        success: true,
        data: {
          card: {
            assigned: Boolean(user.rfid_uid),
            masked_uid: maskCardUid(user.rfid_uid),
            status: cardStatusFor(user),
          },
          wallet: {
            balance_mmk: wallet.balance_mmk,
            status: wallet.status,
          },
          transactions,
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.get("/merchants", protect, async (req, res) => {
  try {
    const manager = ["Admin", "Staff"].includes(req.user?.role);
    const merchants = await PrimeCityMerchant.find(
      manager ? {} : { status: "Active" }
    )
      .sort({ name: 1 })
      .lean();
    return res.json({
      success: true,
      data: merchants.map((merchant) => serializeMerchant(merchant, manager)),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post(
  "/merchants",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
    const name = String(req.body.name || "").trim();
    const location = String(req.body.location || "").trim();
    const description = String(req.body.description || "").trim();
    if (!name || !location || name.length > 120 || location.length > 180) {
      return res.status(400).json({
        success: false,
        message: "A valid merchant name and location are required",
      });
    }

    try {
      let merchant = null;
      for (let attempt = 0; attempt < 4 && !merchant; attempt += 1) {
        try {
          merchant = await PrimeCityMerchant.create({
            merchant_code: createMerchantCode(),
            name,
            location,
            description,
            created_by: getUserId(req),
          });
        } catch (error) {
          if (error.code !== 11000 || attempt === 3) throw error;
        }
      }

      await recordAdminAudit({
        adminUserId: getUserId(req),
        action: "PRIME_CITY_MERCHANT_CREATED",
        entityType: "PrimeCityMerchant",
        entityId: merchant._id,
        metadata: { merchant_code: merchant.merchant_code, name, location },
      });
      return res.status(201).json({
        success: true,
        data: serializeMerchant(merchant, true),
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.post(
  "/pay",
  protect,
  authorizeRoles("Resident", "Citizen"),
  async (req, res) => {
    const merchantId = String(req.body.merchant_id || "").trim();
    const amount = Number(req.body.amount_mmk);
    const note = String(req.body.note || "").trim();
    const idempotencyKey = String(req.body.idempotency_key || "").trim();

    if (!mongoose.Types.ObjectId.isValid(merchantId)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Choose a valid Prime City merchant",
        });
    }
    if (!Number.isInteger(amount) || amount <= 0 || amount > 50000000) {
      return res.status(400).json({
        success: false,
        message:
          "Payment must be a positive whole MMK amount up to 50,000,000 MMK",
      });
    }
    if (note.length > 160) {
      return res.status(400).json({
        success: false,
        message: "Payment note must not exceed 160 characters",
      });
    }
    if (!/^[A-Za-z0-9._:-]{12,100}$/.test(idempotencyKey)) {
      return res.status(400).json({
        success: false,
        message: "A valid payment idempotency key is required",
      });
    }

    try {
      const existing = await RfidWalletTransaction.findOne({
        idempotency_key: idempotencyKey,
      })
        .populate("merchant_id", "merchant_code name location")
        .lean();
      if (existing) {
        if (String(existing.user_id) !== String(getUserId(req))) {
          return res
            .status(409)
            .json({ success: false, message: "Payment key conflict" });
        }
        return res.json({
          success: true,
          duplicate: true,
          data: existing,
        });
      }
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    const session = await mongoose.startSession();
    let transaction;
    let merchant;
    try {
      await session.withTransaction(async () => {
        const resident = await User.findOne({
          _id: getUserId(req),
          role: { $in: ["Resident", "Citizen"] },
        })
          .select("_id rfid_uid card_status")
          .session(session);
        if (
          !resident ||
          !resident.rfid_uid ||
          cardStatusFor(resident) !== "active"
        ) {
          const error = new Error(
            "An active RFID card is required for wallet payment"
          );
          error.status = 409;
          throw error;
        }

        merchant = await PrimeCityMerchant.findOne({
          _id: merchantId,
          status: "Active",
        }).session(session);
        if (!merchant) {
          const error = new Error("Merchant is not active or does not exist");
          error.status = 404;
          throw error;
        }

        const wallet = await RfidWallet.findOne({
          user_id: resident._id,
          status: "Active",
        }).session(session);
        if (!wallet || wallet.balance_mmk < amount) {
          const error = new Error("Insufficient wallet balance");
          error.status = 409;
          throw error;
        }

        wallet.balance_mmk -= amount;
        merchant.wallet_balance_mmk += amount;
        merchant.lifetime_sales_mmk += amount;
        await Promise.all([
          wallet.save({ session }),
          merchant.save({ session }),
        ]);

        [transaction] = await RfidWalletTransaction.create(
          [
            {
              wallet_id: wallet._id,
              user_id: resident._id,
              type: "Payment",
              amount_mmk: amount,
              balance_after_mmk: wallet.balance_mmk,
              description: note || `Purchase at ${merchant.name}`,
              reference_type: "PrimeCityMerchant",
              reference_id: merchant._id,
              merchant_id: merchant._id,
              payment_reference: createPaymentReference(),
              idempotency_key: idempotencyKey,
              created_by: resident._id,
            },
          ],
          { session }
        );
      });

      try {
        const notification = await Notification.create({
          user_id: getUserId(req),
          title: "Wallet payment successful",
          message: `${amount.toLocaleString("en-US")} MMK paid to ${
            merchant.name
          }. Reference: ${transaction.payment_reference}.`,
          type: "General",
          data: {
            wallet_transaction_id: String(transaction._id),
            merchant_id: String(merchant._id),
            merchant_name: merchant.name,
            amount_mmk: amount,
            payment_reference: transaction.payment_reference,
          },
        });
        emitNotification(req.app, getUserId(req), notification);
        try {
          await sendPushToUser(getUserId(req), {
            title: notification.title,
            message: notification.message,
            type: notification.type,
            data: notification.data,
            notification_id: String(notification._id),
          });
        } catch (pushError) {
          console.error("Wallet receipt push failed:", pushError.message);
        }
      } catch (notificationError) {
        console.error(
          "Wallet receipt notification failed:",
          notificationError.message
        );
      }

      try {
        await transaction.populate(
          "merchant_id",
          "merchant_code name location"
        );
      } catch (populateError) {
        console.error(
          "Wallet receipt population failed:",
          populateError.message
        );
      }
      return res.status(201).json({ success: true, data: transaction });
    } catch (error) {
      if (error.code === 11000) {
        const existing = await RfidWalletTransaction.findOne({
          idempotency_key: idempotencyKey,
          user_id: getUserId(req),
        }).populate("merchant_id", "merchant_code name location");
        if (existing) {
          return res.json({ success: true, duplicate: true, data: existing });
        }
      }
      return res.status(error.status || 500).json({
        success: false,
        message: error.message,
      });
    } finally {
      await session.endSession();
    }
  }
);

router.post(
  "/merchants/:id/settle",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
    const amount = Number(req.body.amount_mmk);
    const reference = String(req.body.reference || "").trim();
    const note = String(req.body.note || "").trim();
    if (!Number.isInteger(amount) || amount <= 0 || !reference) {
      return res.status(400).json({
        success: false,
        message:
          "A positive whole MMK amount and settlement reference are required",
      });
    }

    const session = await mongoose.startSession();
    let merchant;
    let settlement;
    try {
      await session.withTransaction(async () => {
        merchant = await PrimeCityMerchant.findById(req.params.id).session(
          session
        );
        if (!merchant) {
          const error = new Error("Merchant not found");
          error.status = 404;
          throw error;
        }
        if (merchant.wallet_balance_mmk < amount) {
          const error = new Error("Settlement exceeds merchant wallet balance");
          error.status = 409;
          throw error;
        }
        merchant.wallet_balance_mmk -= amount;
        await merchant.save({ session });
        [settlement] = await MerchantSettlement.create(
          [
            {
              merchant_id: merchant._id,
              amount_mmk: amount,
              reference,
              note,
              settled_by: getUserId(req),
            },
          ],
          { session }
        );
      });
      await recordAdminAudit({
        adminUserId: getUserId(req),
        action: "MERCHANT_WALLET_SETTLED",
        entityType: "PrimeCityMerchant",
        entityId: merchant._id,
        metadata: { amount_mmk: amount, reference },
      });
      return res.status(201).json({
        success: true,
        data: {
          settlement,
          merchant: serializeMerchant(merchant, true),
        },
      });
    } catch (error) {
      return res.status(error.status || 500).json({
        success: false,
        message: error.message,
      });
    } finally {
      await session.endSession();
    }
  }
);

router.get(
  "/merchants/:id/ledger",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid merchant" });
    }
    try {
      const merchant = await PrimeCityMerchant.findById(req.params.id).lean();
      if (!merchant) {
        return res
          .status(404)
          .json({ success: false, message: "Merchant not found" });
      }
      const [payments, settlements] = await Promise.all([
        RfidWalletTransaction.find({
          merchant_id: merchant._id,
          type: "Payment",
        })
          .select(
            "amount_mmk description payment_reference balance_after_mmk user_id created_at"
          )
          .populate("user_id", "fullname room_id")
          .sort({ created_at: -1 })
          .limit(50)
          .lean(),
        MerchantSettlement.find({ merchant_id: merchant._id })
          .sort({ created_at: -1 })
          .limit(50)
          .lean(),
      ]);
      return res.json({
        success: true,
        data: {
          merchant: serializeMerchant(merchant, true),
          payments,
          settlements,
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.post(
  "/adjust",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
    const residentId = String(req.body.resident_id || "").trim();
    const type = String(req.body.type || "").trim();
    const amount = Number(req.body.amount_mmk);
    const description = String(req.body.description || "").trim();

    if (!mongoose.Types.ObjectId.isValid(residentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid resident_id is required" });
    }
    if (!["Credit", "Adjustment"].includes(type)) {
      return res
        .status(400)
        .json({ success: false, message: "type must be Credit or Adjustment" });
    }
    if (!Number.isInteger(amount) || amount <= 0 || !description) {
      return res.status(400).json({
        success: false,
        message: "A positive whole MMK amount and description are required",
      });
    }

    const session = await mongoose.startSession();
    try {
      let transaction;
      let balance;
      await session.withTransaction(async () => {
        const resident = await User.findOne({
          _id: residentId,
          role: { $in: ["Resident", "Citizen"] },
        })
          .select("_id rfid_uid card_status")
          .session(session);
        if (!resident) {
          const error = new Error("Resident not found");
          error.status = 404;
          throw error;
        }
        if (!resident.rfid_uid || cardStatusFor(resident) !== "active") {
          const error = new Error("An active RFID card must be assigned first");
          error.status = 409;
          throw error;
        }

        let wallet = await RfidWallet.findOne({
          user_id: resident._id,
        }).session(session);
        if (!wallet) {
          [wallet] = await RfidWallet.create(
            [{ user_id: resident._id, balance_mmk: 0, status: "Active" }],
            { session }
          );
        }
        if (wallet.status !== "Active") {
          const error = new Error("RFID wallet is frozen");
          error.status = 409;
          throw error;
        }

        wallet.balance_mmk += amount;
        await wallet.save({ session });
        balance = wallet.balance_mmk;
        [transaction] = await RfidWalletTransaction.create(
          [
            {
              wallet_id: wallet._id,
              user_id: resident._id,
              type,
              amount_mmk: amount,
              balance_after_mmk: balance,
              description,
              reference_type: "Admin",
              created_by: getUserId(req),
            },
          ],
          { session }
        );
      });

      await recordAdminAudit({
        adminUserId: getUserId(req),
        action: "RFID_WALLET_ADJUSTED",
        entityType: "RfidWallet",
        entityId: residentId,
        metadata: { type, amount_mmk: amount, description },
      });

      return res.status(201).json({
        success: true,
        data: { transaction, balance_mmk: balance },
      });
    } catch (error) {
      return res.status(error.status || 500).json({
        success: false,
        message: error.message,
      });
    } finally {
      await session.endSession();
    }
  }
);

module.exports = router;
