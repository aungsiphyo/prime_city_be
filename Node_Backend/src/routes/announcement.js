const express = require("express");
const router = express.Router();
const Announcement = require("../models/Announcement");

router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 50);
    const { type, q } = req.query;

    const filter = {};
    if (type) filter.type = type;
    if (q) {
      const regex = new RegExp(q.trim(), "i");
      filter.$or = [{ title: regex }, { message: regex }];
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Announcement.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
      Announcement.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: {
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("GET /announcements error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { user_id, title, message, type } = req.body;

    const announcement = await Announcement.create({
      user_id,
      title,
      message,
      type,
    });

    const io = req.app.get("io");

    io.emit("announcement", announcement);

    res.json({ message: "Announcement created", announcement });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
