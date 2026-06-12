const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");

// 1. GET ALL NOTIFICATIONS (Add this new endpoint!)
router.get('/', async (expressReq, expressRes) => {
  try {
    // Fetch notifications sorted by newest first
    const notifications = await Notification.find().sort({ created_at: -1 });
    expressRes.status(200).json({ success: true, data: notifications });
  } catch (error) {
    expressRes.status(500).json({ success: false, message: error.message });
  }
});

// 2. MARK ALL AS READ (Optional but highly recommended for your UI button)
router.put('/mark-all-read', async (expressReq, expressRes) => {
  try {
    await Notification.updateMany({ is_read: false }, { $set: { is_read: true } });
    expressRes.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    expressRes.status(500).json({ success: false, message: error.message });
  }
});


router.post("/send", async (req, res) => {
  try {
    const { user_id, title, message, type } = req.body;

    const noti = await Notification.create({
      user_id,
      title,
      message,
      type,
    });

    const io = req.app.get("io");
    const users = req.app.get("onlineUsers");

    const socketId = users[user_id];

    if (socketId) {
      io.to(socketId).emit("notification", noti);
    }

    res.json({ message: "Notification sent", noti });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
