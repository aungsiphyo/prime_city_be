const mongoose = require("mongoose");

const aiUserMemorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    honorific: {
      type: String,
      enum: ["neutral", "shin", "khinbya"],
      default: "neutral",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("AiUserMemory", aiUserMemorySchema);
