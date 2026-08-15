const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const User = require("../models/User");
const { normalizeAssignableRole } = require("../utils/authPolicy");
const PRIVATE_USER_FIELDS =
  "-password -otp -otpExpires -otpPurpose -refreshTokens";

router.get("/users", protect, authorizeRoles("Admin"), async (req, res) => {
  try {
    const users = await User.find().select(PRIVATE_USER_FIELDS);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete(
  "/users/:id",
  protect,
  authorizeRoles("Admin"),
  async (req, res) => {
    try {
      await User.findByIdAndDelete(req.params.id);
      res.json({ message: "User deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

router.put(
  "/users/:id",
  protect,
  authorizeRoles("Admin"),
  async (req, res) => {
    try {
      const { fullname, email, phone, room_id, role, profile_image } = req.body;

      const updateFields = {};
      if (fullname !== undefined) updateFields.fullname = fullname;
      if (email !== undefined) updateFields.email = email;
      if (phone !== undefined) updateFields.phone = phone;
      if (room_id !== undefined) updateFields.room_id = room_id;
      if (role !== undefined) {
        const normalizedRole = normalizeAssignableRole(role);
        if (!normalizedRole) {
          return res.status(400).json({ message: "Invalid user role" });
        }
        updateFields.role = normalizedRole;
      }
      if (profile_image !== undefined) updateFields.profile_image = profile_image;

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { $set: updateFields },
        { new: true, select: PRIVATE_USER_FIELDS, runValidators: true },
      );

      if (!user) return res.status(404).json({ message: "User not found" });

      res.json({ message: "User updated", user });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.put(
  "/users/:id/role",
  protect,
  authorizeRoles("Admin"),
  async (req, res) => {
    try {
      const role = normalizeAssignableRole(req.body.role);

      if (!role) {
        return res.status(400).json({ message: "Invalid user role" });
      }

      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      user.role = role;
      await user.save();

      const safeUser = await User.findById(user._id).select(PRIVATE_USER_FIELDS);
      res.json({ message: "Role updated", user: safeUser });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
