const mongoose = require("mongoose");

const MerchantSettlementSchema = new mongoose.Schema(
  {
    merchant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PrimeCityMerchant",
      required: true,
      index: true,
    },
    amount_mmk: { type: Number, min: 1, required: true },
    reference: { type: String, trim: true, maxlength: 120, required: true },
    note: { type: String, trim: true, maxlength: 300, default: "" },
    settled_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

MerchantSettlementSchema.index({ merchant_id: 1, created_at: -1 });

module.exports = mongoose.model("MerchantSettlement", MerchantSettlementSchema);
