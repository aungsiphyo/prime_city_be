const mongoose = require("mongoose");

const ServiceBillSchema = new mongoose.Schema(
  {
    room_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      index: true,
    },
    resident_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    title: { type: String, trim: true, default: "Service bill" },
    type: { type: String, trim: true, default: "General" },
    billing_month: { type: Number, min: 1, max: 12, default: null },
    billing_year: { type: Number, min: 2000, max: 2200, default: null },
    billing_key: { type: String, trim: true, default: null },
    electricity_amount: { type: Number, min: 0, default: 0 },
    water_amount: { type: Number, min: 0, default: 0 },
    installment_amount: { type: Number, min: 0, default: 0 },
    maintenance_amount: { type: Number, min: 0, default: 0 },
    service_amount: { type: Number, min: 0, default: 0 },
    other_amount: { type: Number, min: 0, default: 0 },
    other_description: { type: String, trim: true, maxlength: 240, default: "" },
    payment_window_days: { type: Number, min: 1, max: 31, default: 7 },
    service_cutoff_warning: {
      type: String,
      trim: true,
      default:
        "Pay within 7 days. Electricity and water services may be suspended after the due date if this bill remains unpaid.",
    },
    installment_applied: { type: Boolean, default: false },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: [
        "Pending",
        "Payment Submitted",
        "Under Review",
        "Paid",
        "Rejected",
        "Overdue",
        "Pending Verification",
      ],
      default: "Pending",
      index: true,
    },
    due_date: { type: Date, required: true },
    paid_at: { type: Date, default: null },
    approved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    payment_method: { type: String, trim: true, default: "" },
    transaction_id: { type: String, trim: true, default: "" },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

ServiceBillSchema.index({ room_id: 1, due_date: -1, created_at: -1 });
ServiceBillSchema.index(
  { billing_key: 1 },
  {
    unique: true,
    partialFilterExpression: { billing_key: { $type: "string" } },
  },
);

module.exports = mongoose.model("ServiceBill", ServiceBillSchema);
