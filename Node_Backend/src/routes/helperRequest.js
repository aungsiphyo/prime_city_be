const express = require("express");
const router = express.Router();
const HelperRequest = require("../models/HelperRequest");

router.get("/", async (req, res) => {
  try {
    const requests = await HelperRequest.find();
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const request = await HelperRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: "Not found" });
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const request = await HelperRequest.create(req.body);

    const io = req.app.get("io");

    io.emit("helper_request", request);

    res.json({ message: "Helper requested", request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const request = await HelperRequest.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true },
    );

    const io = req.app.get("io");

    io.emit("helper_request", request);

    res.json({ message: "Request updated", request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
