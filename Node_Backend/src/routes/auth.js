const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Room = require("../models/Room");
const Visitor = require("../models/Visitor");
const sendEmail = require("../utils/sendEmail");
const {
  getAuthenticatedRole,
  getReviewerAccessConfig,
  isReviewerEmail,
  isReviewerOtp,
  isReviewerPassword,
} = require("../utils/reviewerAccess");
const { resolveCurrentRoom } = require("../services/aiTools.service");

const router = express.Router();
const reviewerAccess = getReviewerAccessConfig();

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function normalizeRfidUid(value) {
  return String(value || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase();
}

async function findRoomByRef(roomRef) {
  const normalizedRoomRef = String(roomRef || "").trim();

  if (!normalizedRoomRef) return null;

  const query = isObjectId(normalizedRoomRef)
    ? { $or: [{ _id: normalizedRoomRef }, { room_name: normalizedRoomRef }] }
    : { room_name: normalizedRoomRef };

  return Room.findOne(query);
}

async function syncUserRoom(user, room) {
  if (!room) return user;

  room.resident_id = user._id;
  room.owner_name = user.fullname;
  room.status = "Occupied";
  await room.save();

  if (String(user.room_id) !== String(room._id)) {
    user.room_id = String(room._id);
    await user.save();
  }

  return user;
}

const generateTokens = (user, role = user.role) => {
  const accessToken = jwt.sign(
    { id: user._id, role },
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
    const { fullname, email, phone, password, role, room_id, rfid_uid, profile_image } =
      req.body;
    const linkedRoom = room_id ? await findRoomByRef(room_id) : null;
    const normalizedRfidUid = normalizeRfidUid(rfid_uid);

    if (room_id && !linkedRoom) {
      return res.status(400).json({ message: "Room not found for room_id" });
    }

    if (linkedRoom?.resident_id) {
      return res.status(400).json({ message: "Room already has a resident" });
    }

    const userExists = await User.findOne({ $or: [{ email }, { phone }] });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    if (normalizedRfidUid) {
      const [userCardExists, visitorCardExists] = await Promise.all([
        User.exists({ rfid_uid: normalizedRfidUid }),
        Visitor.exists({ rfid_uid: normalizedRfidUid }),
      ]);

      if (userCardExists || visitorCardExists) {
        return res.status(400).json({
          message: "RFID card is already assigned",
        });
      }
    }

    const newUser = new User({
      fullname,
      email,
      phone,
      password,
      role,
      room_id: linkedRoom ? String(linkedRoom._id) : room_id,
      rfid_uid: normalizedRfidUid || undefined,
      profile_image: profile_image || null,
    });
    await newUser.save();
    await syncUserRoom(newUser, linkedRoom);

    res.status(201).json({
      message: "Register success",
      user: {
        id: newUser._id,
        resident_uid: newUser.resident_uid,
        rfid_uid: newUser.rfid_uid || null,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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

    const submittedEmail = String(email).trim();
    const loginEmail = isReviewerEmail(submittedEmail, reviewerAccess)
      ? reviewerAccess.email
      : submittedEmail;
    const user = await User.findOne({ email: loginEmail });
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const reviewerLogin = isReviewerEmail(user.email, reviewerAccess);
    const isMatch = reviewerLogin
      ? isReviewerPassword(user.email, password, reviewerAccess)
      : await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Wrong password" });
    }

    if (reviewerLogin) {
      // The fixed code is armed only after the reviewer supplies the correct
      // password. It is cleared after successful verification and can be
      // armed again with the same value on every future sign-in.
      user.otp = reviewerAccess.otp;
      user.otpExpires = undefined;
      user.otpPurpose = "login";
      await user.save();

      return res.status(200).json({
        message: "Use the reusable reviewer OTP configured in Play Console",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + 5 * 60 * 1000;
    user.otpPurpose = "login";
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
        .json({ message: "Failed to send Email OTP. Please try again.", error: mailErr.message, stack: mailErr.stack });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= LOGIN STEP 2 =================
router.post("/login/step2", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || otp === undefined || otp === null) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const submittedEmail = String(email).trim();
    const submittedOtp = String(otp).trim();
    const reviewerOtpMatches = isReviewerOtp(
      submittedEmail,
      submittedOtp,
      reviewerAccess,
    );

    const otpQuery = reviewerOtpMatches
      ? {
          email: reviewerAccess.email,
          otp: reviewerAccess.otp,
          otpPurpose: "login",
        }
      : {
          email: submittedEmail,
          otp: submittedOtp,
          otpPurpose: "login",
          otpExpires: { $gt: Date.now() },
        };

    const user = await User.findOne(otpQuery);

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const authenticatedRole = getAuthenticatedRole(user, reviewerAccess);
    const { accessToken, refreshToken } = generateTokens(
      user,
      authenticatedRole,
    );
    // store refresh token in an array to support multiple sessions/devices
    user.refreshTokens = Array.isArray(user.refreshTokens)
      ? user.refreshTokens
      : [];
    user.refreshTokens.push(refreshToken);
    user.otp = undefined;
    user.otpExpires = undefined;
    user.otpPurpose = undefined;

    await user.save();
    const resolvedRoom = await resolveCurrentRoom(user);

    res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        resident_uid: user.resident_uid,
        rfid_uid: user.rfid_uid || null,
        fullname: user.fullname,
        email: user.email,
        phone: user.phone,
        role: authenticatedRole,
        room_id: user.room_id || null,
        room_number: resolvedRoom.room?.room_name || null,
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
    user.otpPurpose = "password-reset";
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
      otpPurpose: "password-reset",
      otpExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.password = newPassword;
    user.otp = undefined;
    user.otpExpires = undefined;
    user.otpPurpose = undefined;

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

    const authenticatedRole = getAuthenticatedRole(user, reviewerAccess);
    const accessToken = jwt.sign(
      { id: user._id, role: authenticatedRole },
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
