const mongoose = require("mongoose");

const aiFeedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    aiChatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiChat",
      required: true,
      index: true,
    },
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    messageId: {
      type: String,
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      enum: [-1, 1],
      required: true,
    },
    helpful: {
      type: Boolean,
      required: true,
    },
    feedbackType: {
      type: String,
      enum: ["helpful", "not_helpful", "incorrect", "missing_information", "other"],
      default: "not_helpful",
      index: true,
    },
    resolved: {
      type: Boolean,
      default: null,
    },
    comment: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    source: {
      type: String,
      default: "mobile",
      trim: true,
    },
    appVersion: {
      type: String,
      default: "",
      trim: true,
    },
    reviewStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: "", trim: true, maxlength: 1000 },
    approvedKnowledgeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Knowledge",
      default: null,
    },
  },
  { timestamps: true },
);

aiFeedbackSchema.index(
  { userId: 1, conversationId: 1, messageId: 1 },
  { unique: true },
);
aiFeedbackSchema.index({ reviewStatus: 1, createdAt: -1 });

module.exports = mongoose.model("AiFeedback", aiFeedbackSchema);
