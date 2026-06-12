const express = require("express");
const router = express.Router();
const ServiceBill = require("../models/ServiceBill");

router.get("/", async (req, res) => {
  try {
    const bills = await ServiceBill.find()
      .populate("room_id")
      .sort({ created_at: -1 });

    res.json({
      success: true,
      data: bills,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const bill = await ServiceBill.create(req.body);

    const io = req.app.get("io");
    if (io) io.emit("bill_update", bill);

    res.json({
      success: true,
      message: "Bill created",
      bill,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const bill = await ServiceBill.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    const io = req.app.get("io");
    if (io) io.emit("bill_update", bill);

    res.json({
      success: true,
      message: "Bill updated",
      bill,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
