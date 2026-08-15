const mongoose = require("mongoose");

const BillPaymentSubmissionSchema = new mongoose.Schema(
  {
    bill_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceBill",
      required: true,
      index: true,
    },
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
    expected_amount: { type: Number, required: true, min: 0 },
    submitted_amount: { type: Number, required: true, min: 0 },
    screenshot_file_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      select: false,
    },
    screenshot_path: { type: String, default: null, select: false },
    storage_driver: {
      type: String,
      enum: ["MongoGridFS", "PrivateFile"],
      default: "PrivateFile",
      select: false,
    },
    screenshot_mime: {
      type: String,
      enum: ["image/jpeg", "image/png", "image/webp"],
      required: true,
      select: false,
    },
    screenshot_size: { type: Number, required: true, min: 1, select: false },
    user_note: { type: String, trim: true, maxlength: 500, default: "" },
    status: {
      type: String,
      enum: [
        "Pending",
        "Under Review",
        "Approved",
        "Rejected",
        "Resubmission Required",
      ],
      default: "Pending",
      index: true,
    },
    is_active: { type: Boolean, default: true },
    submitted_at: { type: Date, default: Date.now },
    reviewed_at: { type: Date, default: null },
    reviewed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    admin_note: { type: String, trim: true, maxlength: 500, default: "" },
    rejection_reason: { type: String, trim: true, maxlength: 240, default: "" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

BillPaymentSubmissionSchema.index({ user_id: 1, submitted_at: -1 });
BillPaymentSubmissionSchema.index({ room_id: 1, status: 1, submitted_at: -1 });
BillPaymentSubmissionSchema.index(
  { bill_id: 1, is_active: 1 },
  {
    unique: true,
    partialFilterExpression: { is_active: true },
  },
);

module.exports = mongoose.model(
  "BillPaymentSubmission",
  BillPaymentSubmissionSchema,
);
