const mongoose = require("mongoose");

const ServiceBillSchema = new mongoose.Schema({
  room_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Room",
    required: true,
    index: true,
  },
  title: { type: String, trim: true, default: "Service bill" },
  type: { type: String, trim: true, default: "General" },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ["Pending", "Paid", "Overdue", "Pending Verification"],
    default: "Pending",
  },
  due_date: { type: Date, required: true },
  paid_at: { type: Date, default: null },
  payment_method: { type: String, trim: true, default: "" },
  transaction_id: { type: String, trim: true, default: "" },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("ServiceBill", ServiceBillSchema);
