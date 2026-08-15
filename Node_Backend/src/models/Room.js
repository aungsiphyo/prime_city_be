const mongoose = require("mongoose");

const RoomSchema = new mongoose.Schema(
  {
    room_name: { type: String, required: true, unique: true, trim: true },
    building: { type: String, default: "A", trim: true },
    floor: { type: Number, required: true },
    room_type: {
      type: String,
      enum: ["Business", "Office", "Standard", "Premium"],
      required: true,
      default: "Standard",
    },
    status: {
      type: String,
      enum: ["Available", "Occupied", "Maintenance"],
      default: "Available",
    },
    resident_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    owner_name: {
      type: String,
      trim: true,
      default: "",
    },
    purchase_price: { type: Number, min: 0, default: 0 },
    purchase_date: { type: Date, default: Date.now },
    down_payment_percent: { type: Number, min: 0, max: 100, default: 40 },
    down_payment_amount: { type: Number, min: 0, default: 0 },
    down_payment_status: {
      type: String,
      enum: ["Paid", "Pending"],
      default: "Paid",
    },
    down_payment_paid_at: { type: Date, default: Date.now },
    financed_amount: { type: Number, min: 0, default: 0 },
    installment_months: { type: Number, min: 0, default: 60 },
    monthly_installment_amount: { type: Number, min: 0, default: 0 },
    installments_paid: { type: Number, min: 0, default: 0 },
    installment_remaining_amount: { type: Number, min: 0, default: 0 },
    installment_start_date: { type: Date, default: Date.now },
    installment_end_date: { type: Date, default: null },
    installment_status: {
      type: String,
      enum: ["Active", "Paid"],
      default: "Active",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Room", RoomSchema);
