const mongoose = require("mongoose");

const RfidWalletTransactionSchema = new mongoose.Schema(
  {
    wallet_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RfidWallet",
      required: true,
      index: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["Credit", "Payment", "Refund", "Adjustment"],
      required: true,
      index: true,
    },
    amount_mmk: { type: Number, min: 1, required: true },
    balance_after_mmk: { type: Number, min: 0, required: true },
    description: { type: String, trim: true, maxlength: 240, required: true },
    reference_type: { type: String, trim: true, default: "" },
    reference_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    merchant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PrimeCityMerchant",
      default: null,
      index: true,
    },
    payment_reference: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    idempotency_key: {
      type: String,
      trim: true,
      default: null,
      select: false,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

RfidWalletTransactionSchema.index({ user_id: 1, created_at: -1 });
RfidWalletTransactionSchema.index(
  { idempotency_key: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotency_key: { $type: "string" } },
  }
);

module.exports = mongoose.model(
  "RfidWalletTransaction",
  RfidWalletTransactionSchema
);
