const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { generateResidentUid } = require("../utils/generateUid");

function normalizeRfidUid(value) {
  const normalized = String(value || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase();

  return normalized || undefined;
}

const UserSchema = new mongoose.Schema({
  resident_uid: {
    type: String,
    default: generateResidentUid,
    unique: true,
    sparse: true,
    immutable: true,
  },
  rfid_uid: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
    set: normalizeRfidUid,
  },
  fullname: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },

  role: {
    type: String,
    enum: ["Resident", "Admin", "Staff", "Helper", "Security"],
    default: "Resident",
  },

  profile_image: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
  room_id: { type: String },

  otp: { type: String },
  otpExpires: { type: Date },
  otpPurpose: {
    type: String,
    enum: ["login", "password-reset"],
  },
  refreshTokens: [{ type: String }],
});

UserSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model("User", UserSchema);
