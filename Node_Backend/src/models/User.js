const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  fullname: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },

  role: {
    type: String,
    enum: ["Citizen", "Admin", "Staff", "Security"],
    default: "Citizen",
  },

  created_at: { type: Date, default: Date.now },
  room_id: { type: String },

  otp: { type: String },
  otpExpires: { type: Date },
  refreshTokens: [{ type: String }],
});

UserSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model("User", UserSchema);
