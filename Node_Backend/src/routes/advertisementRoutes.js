const express = require("express");
const router = express.Router();
const Advertisement = require("../models/Advertisement");

router.post("/", async (req, res) => {
  try {
    const newAd = new Advertisement(req.body);
    const savedAd = await newAd.save();
    res.status(201).json(savedAd);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const { limit, random } = req.query;
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const limitValue = Number(limit);
    const hasValidLimit = Number.isFinite(limitValue);
    const safeLimit = hasValidLimit ? Math.max(1, limitValue) : 7;

    if (random === "true") {
      const ads = await Advertisement.aggregate([
        { $match: filter },
        { $sample: { size: safeLimit } },
      ]);

      return res.status(200).json(ads);
    }

    const query = Advertisement.find(filter).sort({ created_at: -1 });
    if (hasValidLimit) query.limit(safeLimit);

    const ads = await query.lean();
    res.status(200).json(ads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const ad = await Advertisement.findById(req.params.id);
    if (!ad)
      return res.status(404).json({ message: "Advertisement not found" });
    res.status(200).json(ad);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const updatedAd = await Advertisement.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true },
    );
    if (!updatedAd)
      return res.status(404).json({ message: "Advertisement not found" });
    res.status(200).json(updatedAd);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const deletedAd = await Advertisement.findByIdAndDelete(req.params.id);
    if (!deletedAd)
      return res.status(404).json({ message: "Advertisement not found" });
    res.status(200).json({ message: "Advertisement deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
