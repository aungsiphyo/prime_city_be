const mongoose = require("mongoose");

const VisitorSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true, default: "" },
    lastName: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },

    fullname: { type: String, trim: true, default: "" },
    phone: { type: String, required: true, trim: true },
    nric_number: { type: String, trim: true, default: "" },

    company: { type: String, trim: true, default: "" },
    hostName: { type: String, trim: true, default: "" },

    target_room_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      default: null,
    },

    purpose: {
      type: String,
      enum: [
        "Meeting",
        "Interview",
        "Delivery",
        "Event",
        "Tour",
        "Service",
        "Other",
        "General",
        "",
      ],
      default: "Other",
    },

    reason_for_visit: { type: String, trim: true, default: "" },
    purposeDetail: { type: String, trim: true, default: "" },

    parking_slot_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VisCarParking",
      default: null,
    },

    agreedToTerms: { type: Boolean, default: false },

    badgeNumber: { type: String, default: "" },
    check_in_time: { type: Date, default: Date.now },
    check_out_time: { type: Date, default: null },
    visitDate: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

VisitorSchema.pre("save", function () {
  if (this.firstName || this.lastName) {
    this.fullname = `${this.firstName} ${this.lastName}`.trim();
  } else if (this.fullname && !this.firstName) {
    const parts = this.fullname.split(" ");
    this.firstName = parts[0] || "";
    this.lastName = parts.slice(1).join(" ") || "";
  }

  if (this.purposeDetail && !this.reason_for_visit) {
    this.reason_for_visit = this.purposeDetail;
  } else if (this.reason_for_visit && !this.purposeDetail) {
    this.purposeDetail = this.reason_for_visit;
  }

  if (this.isNew && !this.badgeNumber) {
    const d = new Date();
    const prefix = `V${d.getFullYear()}${String(d.getMonth() + 1).padStart(
      2,
      "0",
    )}${String(d.getDate()).padStart(2, "0")}`;
    const uniqueSuffix = String(this._id).slice(-6).toUpperCase();
    this.badgeNumber = `${prefix}-${uniqueSuffix}`;
  }
});

module.exports = mongoose.model("Visitor", VisitorSchema);
