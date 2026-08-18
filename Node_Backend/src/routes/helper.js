const express = require("express");
const router = express.Router();
const Helper = require("../models/Helper");
const { getHelperCatalog } = require("../services/communityCatalog.service");

router.get("/catalog", (_req, res) => {
  res.json({ success: true, data: getHelperCatalog() });
});

router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.gender) filter.gender = req.query.gender;

    const helpers = await Helper.find(filter).sort({ created_at: -1 });
    res.json(helpers);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const helper = await Helper.findById(req.params.id);
    if (!helper) return res.status(404).json({ success: false, message: "Not found" });
    res.json(helper);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const helper = await Helper.create(req.body);
    res.json(helper);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const helper = await Helper.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(helper);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await Helper.findByIdAndDelete(req.params.id);
    res.json({ message: "Helper deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
