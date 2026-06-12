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

    res.status(201).json({ message: "Register success" });
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

    user.refreshToken = refreshToken;
    user.otp = undefined;
    user.otpExpires = undefined;

    await user.save();

    res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
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

    const user = await User.findOne({ refreshToken });
    if (!user)
      return res.status(403).json({ message: "Invalid refresh token" });

    jwt.verify(refreshToken, process.env.REFRESH_SECRET, (err, decoded) => {
      if (err)
        return res
          .status(403)
          .json({ message: "Expired or invalid refresh token" });

      const accessToken = jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "15m" },
      );
      res.json({ accessToken });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const { email } = req.body;
    await User.findOneAndUpdate({ email }, { refreshToken: undefined });
    res.status(200).json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
