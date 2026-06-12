const mongoose = require("mongoose");

const HelperSchema = new mongoose.Schema({
  fullname: { type: String, required: true },
  age: { type: Number },
  photo: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  gender: { type: String, enum: ["Male", "Female"] },  
    experience: { type: Number },
    nric_number: { type: String, required: true },
    nric_photo_url: { type: String },
    status: { type: String, default: "Active" },
    created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Helper", HelperSchema);
