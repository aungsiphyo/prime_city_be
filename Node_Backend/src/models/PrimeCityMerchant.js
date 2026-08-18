const mongoose = require("mongoose");

const PrimeCityMerchantSchema = new mongoose.Schema(
  {
    merchant_code: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    location: { type: String, trim: true, maxlength: 180, default: "" },
    description: { type: String, trim: true, maxlength: 300, default: "" },
    status: {
      type: String,
      enum: ["Active", "Suspended"],
      default: "Active",
      index: true,
    },
    wallet_balance_mmk: { type: Number, min: 0, default: 0 },
    lifetime_sales_mmk: { type: Number, min: 0, default: 0 },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

module.exports = mongoose.model("PrimeCityMerchant", PrimeCityMerchantSchema);
