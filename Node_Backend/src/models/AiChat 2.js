const mongoose = require("mongoose");

const aiChatSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    toolCalls: {
      type: Array,
      default: [],
    },
    knowledgeSources: {
      type: Array,
      default: [],
    },
    model: {
      type: String,
      default: "",
    },
    usedFallback: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

aiChatSchema.index({ userId: 1, conversationId: 1, createdAt: 1 });

module.exports = mongoose.model("AiChat", aiChatSchema);
