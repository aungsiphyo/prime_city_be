const mongoose = require("mongoose");

const AdvertisementSchema = new mongoose.Schema({
  company_name: { type: String, required: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  image_url: { type: String },
  link_url: { type: String },
  status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
  created_at: { type: Date, default: Date.now },
  duration: { type: Number, required: true },
});

module.exports = mongoose.model("Advertisement", AdvertisementSchema);
