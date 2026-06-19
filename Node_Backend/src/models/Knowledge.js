const mongoose = require("mongoose");

const CATEGORY_VALUES = [
  "parking",
  "visitor",
  "sos",
  "rfid",
  "maintenance",
  "billing",
  "app",
  "admin",
  "announcement",
  "general",
];

const AUDIENCE_VALUES = [
  "user",
  "resident",
  "admin",
  "staff",
  "security",
  "all",
];

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value;
}

function normalizeEnum(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];

  return tags
    .map((tag) => String(tag || "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 30);
}

const knowledgeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      set: normalizeText,
      maxlength: 160,
    },
    category: {
      type: String,
      enum: CATEGORY_VALUES,
      default: "general",
      set: normalizeEnum,
      index: true,
    },
    audience: {
      type: String,
      enum: AUDIENCE_VALUES,
      default: "all",
      set: normalizeEnum,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      set: normalizeText,
      maxlength: 10000,
    },
    tags: {
      type: [String],
      default: [],
      set: normalizeTags,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

knowledgeSchema.index(
  {
    title: "text",
    content: "text",
    tags: "text",
  },
  {
    name: "knowledge_text_index",
    weights: {
      title: 5,
      tags: 3,
      content: 1,
    },
  },
);

const Knowledge = mongoose.model("Knowledge", knowledgeSchema);

module.exports = Knowledge;
module.exports.CATEGORY_VALUES = CATEGORY_VALUES;
module.exports.AUDIENCE_VALUES = AUDIENCE_VALUES;
