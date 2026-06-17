const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const User = require("../models/User");

router.get("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "-password -otp -otpExpires -refreshTokens",
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Profile access granted",
      user: {
        id: user._id,
        resident_uid: user.resident_uid || null,
        fullname: user.fullname,
        email: user.email,
        phone: user.phone,
        role: user.role,
        room_id: user.room_id || null,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/admin", protect, authorizeRoles("Admin"), (req, res) => {
  res.json({ message: "Welcome Admin" });
});

router.get("/staff", protect, authorizeRoles("Staff", "Admin"), (req, res) => {
  res.json({ message: "Welcome Staff/Admin" });
});

module.exports = router;
