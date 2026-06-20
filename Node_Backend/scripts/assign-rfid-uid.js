require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../src/models/User");
const Visitor = require("../src/models/Visitor");

function normalizeRfidUid(value) {
  return String(value || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase();
}

async function main() {
  const [type, systemUid, rawRfidUid] = process.argv.slice(2);
  const rfidUid = normalizeRfidUid(rawRfidUid);

  if (!["resident", "visitor"].includes(type) || !systemUid || !rfidUid) {
    console.error(
      "Usage: node scripts/assign-rfid-uid.js <resident|visitor> <system_uid> <rfid_uid>",
    );
    console.error(
      "Example: node scripts/assign-rfid-uid.js resident RES-9032cd19-86f6-48ad-aac0-2ca7c5a3ae48 27095007",
    );
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const Model = type === "resident" ? User : Visitor;
  const query =
    type === "resident" ? { resident_uid: systemUid } : { visitor_uid: systemUid };

  const existingResident = await User.findOne({ rfid_uid: rfidUid })
    .select("_id resident_uid fullname")
    .lean();
  const existingVisitor = await Visitor.findOne({ rfid_uid: rfidUid })
    .select("_id visitor_uid fullname")
    .lean();

  if (existingResident || existingVisitor) {
    console.error(`RFID UID ${rfidUid} is already assigned.`);
    console.error(existingResident || existingVisitor);
    process.exit(1);
  }

  const updated = await Model.findOneAndUpdate(
    query,
    { $set: { rfid_uid: rfidUid } },
    { new: true },
  ).select("-password -otp -otpExpires -refreshTokens");

  if (!updated) {
    console.error(`${type} not found for uid: ${systemUid}`);
    process.exit(1);
  }

  console.log("RFID UID assigned successfully:");
  console.log(JSON.stringify(updated.toObject(), null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
