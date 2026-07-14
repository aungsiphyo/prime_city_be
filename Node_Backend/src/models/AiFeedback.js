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
  },
  { timestamps: true },
);

aiFeedbackSchema.index(
  { userId: 1, conversationId: 1, messageId: 1 },
  { unique: true },
);

module.exports = mongoose.model("AiFeedback", aiFeedbackSchema);
