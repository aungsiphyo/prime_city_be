const express = require("express");
const router = express.Router();
const Report = require("../models/Report");

router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 50, type, status, q } = req.query;
    const filter = {};

    if (type) filter.type = type;
    if (status) filter.status = status;
    if (q) {
      const regex = new RegExp(q.trim(), "i");
      filter.$or = [{ title: regex }, { message: regex }, { location: regex }];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Report.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Report.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error("GET /reports error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const report = await Report.create(req.body);

    const io = req.app.get("io");

    io.emit("report_update", report);

    res.json({ message: "Report submitted", report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const report = await Report.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    const io = req.app.get("io");

    io.emit("report_update", report);

    res.json({ message: "Report updated", report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
