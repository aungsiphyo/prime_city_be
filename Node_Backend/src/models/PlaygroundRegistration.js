const mongoose = require("mongoose");

const PlaygroundRegistrationSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    room_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      index: true,
    },
    child_name: { type: String, trim: true, maxlength: 100, required: true },
    child_age: { type: Number, min: 1, max: 17, required: true },
    requested_date: { type: Date, required: true, index: true },
    time_slot: {
      type: String,
      enum: ["Morning", "Afternoon", "Evening"],
      required: true,
    },
    guardian_phone: { type: String, trim: true, maxlength: 30, required: true },
    notes: { type: String, trim: true, maxlength: 500, default: "" },
    base_fee_mmk: { type: Number, min: 0, required: true },
    resident_discount_percent: { type: Number, min: 0, max: 100, required: true },
    amount_due_mmk: { type: Number, min: 0, required: true },
    pricing_status: {
      type: String,
      enum: ["Final", "Admin Confirmation"],
      required: true,
    },
    payment_method: {
      type: String,
      enum: ["RFID Wallet", "Pay at desk", "Not required"],
      required: true,
    },
    payment_status: {
      type: String,
      enum: ["Not Required", "Pending", "Paid", "Refunded"],
      required: true,
    },
    payment_transaction_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RfidWalletTransaction",
      default: null,
    },
    status: {
      type: String,
      enum: ["Pending", "Confirmed", "Waitlisted", "Completed", "Cancelled"],
      default: "Pending",
      index: true,
    },
    reviewed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewed_at: { type: Date, default: null },
    admin_note: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

PlaygroundRegistrationSchema.index({ user_id: 1, created_at: -1 });
PlaygroundRegistrationSchema.index({ requested_date: 1, time_slot: 1, status: 1 });

module.exports = mongoose.model(
  "PlaygroundRegistration",
  PlaygroundRegistrationSchema,
);
