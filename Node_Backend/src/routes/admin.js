const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const User = require("../models/User");

router.get("/users", protect, authorizeRoles("Admin"), async (req, res) => {
  try {
    const users = await User.find().select("-password");
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
      if (role !== undefined) updateFields.role = role;
      if (profile_image !== undefined) updateFields.profile_image = profile_image;

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { $set: updateFields },
        { new: true, select: "-password" }
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
      const { role } = req.body;

      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      user.role = role;
      await user.save();

      res.json({ message: "Role updated", user });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
