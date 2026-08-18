const mongoose = require("mongoose");

const RfidWalletSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    balance_mmk: { type: Number, min: 0, default: 0 },
    status: {
      type: String,
      enum: ["Active", "Frozen"],
      default: "Active",
      index: true,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("RfidWallet", RfidWalletSchema);
