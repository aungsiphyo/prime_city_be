const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const sendEmail = require("../utils/sendEmail");

const router = express.Router();

const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );

  const refreshToken = jwt.sign({ id: user._id }, process.env.REFRESH_SECRET, {
    expiresIn: "7d",
  });

  return { accessToken, refreshToken };
};

// ================= SIGNUP =================
router.post("/signup", async (req, res) => {
  try {
    const { fullname, email, phone, password, role, room_id } = req.body;

    const userExists = await User.findOne({ $or: [{ email }, { phone }] });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const newUser = new User({
      fullname,
      email,
      phone,
      password,
      role,
      room_id,
    });
    await newUser.save();

    res.status(201).json({
      message: "Register success",
      user: {
        id: newUser._id,
        resident_uid: newUser.resident_uid,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= LOGIN STEP 1 =================
router.post("/login/step1", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!password || !email) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Wrong password" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + 5 * 60 * 1000;
    await user.save();

    try {
      // 📧 Email ပို့ဆောင်ခြင်း
      await sendEmail(email, otp);
      console.log(`✅ OTP sent to ${email}`);

      res.status(200).json({
        message: "OTP sent to your registered email",
      });
    } catch (mailErr) {
      console.error(`Failed to send OTP to ${email}:`, mailErr);
      res
        .status(500)
        .json({ message: "Failed to send Email OTP. Please try again." });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= LOGIN STEP 2 =================
router.post("/login/step2", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({
      email,
      otp,
      otpExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    // store refresh token in an array to support multiple sessions/devices
    user.refreshTokens = Array.isArray(user.refreshTokens)
      ? user.refreshTokens
      : [];
    user.refreshTokens.push(refreshToken);
    user.otp = undefined;
    user.otpExpires = undefined;

    await user.save();

    res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        resident_uid: user.resident_uid,
        fullname: user.fullname,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= FORGOT PASSWORD STEP 1 =================
router.post("/forgot-password/step1", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + 5 * 60 * 1000;
    await user.save();

    try {
      await sendEmail(email, otp);
      console.log(`🔐 Forgot OTP sent to ${email}: ${otp}`);
      res.status(200).json({ message: "OTP sent to your email" });
    } catch (mailErr) {
      res
        .status(500)
        .json({ message: "Failed to send email. Please try again." });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= FORGOT PASSWORD STEP 2 =================
router.post("/forgot-password/step2", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    const user = await User.findOne({
      email,
      otp,
      otpExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.otp = undefined;
    user.otpExpires = undefined;

    await user.save();

    res.status(200).json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= REFRESH TOKEN & LOGOUT =================
router.post("/refresh-token", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(401).json({ message: "Refresh token required" });

    // verify signature first to get the user id
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
    } catch (err) {
      return res
        .status(403)
        .json({ message: "Expired or invalid refresh token" });
    }

    const user = await User.findById(decoded.id);
    if (!user)
      return res.status(403).json({ message: "Invalid refresh token" });

    // ensure the provided refresh token is recorded for this user
    const tokens = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];
    if (!tokens.includes(refreshToken)) {
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    const accessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      {
        expiresIn: "15m",
      },
    );

    // Optionally: rotate refresh token here by issuing a new refresh token and replacing it in DB.
    res.json({ accessToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const { email, refreshToken } = req.body;
    if (refreshToken) {
      // remove only the provided token
      await User.updateOne(
        { refreshTokens: refreshToken },
        { $pull: { refreshTokens: refreshToken } },
      );
    } else if (email) {
      // clear all tokens for this email (logout everywhere)
      await User.findOneAndUpdate({ email }, { $set: { refreshTokens: [] } });
    }

    res.status(200).json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
