const mongoose = require("mongoose");

const ServiceBillSchema = new mongoose.Schema({
    room_id: {type : mongoose.Schema.Types.ObjectId, ref: "Room", required: true},
    amount: {type: Number, required: true},
    status: {type: String, enum: ["Pending", "Paid", "Overdue"], default: "Pending"},
    due_date: {type: Date, required: true},
    created_at: {type: Date, default: Date.now},
});

module.exports = mongoose.model("ServiceBill", ServiceBillSchema);