require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const Announcement = require("../src/models/Announcement");
const BillPaymentSubmission = require("../src/models/BillPaymentSubmission");
const ServiceBill = require("../src/models/ServiceBill");

const apply = process.argv.includes("--apply");

async function run() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);

  const [legacyAnnouncements, legacyBills] = await Promise.all([
    Announcement.countDocuments({
      $or: [
        { status: { $exists: false } },
        { audience_type: { $exists: false } },
      ],
    }),
    ServiceBill.countDocuments({ electricity_amount: { $exists: false } }),
  ]);

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      legacyAnnouncements,
      legacyBills,
    }),
  );

  if (!apply) return;

  await Promise.all([
    Announcement.updateMany(
      { status: { $exists: false } },
      { $set: { status: "Active" } },
    ),
    Announcement.updateMany(
      { audience_type: { $exists: false } },
      { $set: { audience_type: "All Residents" } },
    ),
    ServiceBill.updateMany(
      { electricity_amount: { $exists: false } },
      {
        $set: {
          electricity_amount: 0,
          water_amount: 0,
          installment_amount: 0,
          maintenance_amount: 0,
          service_amount: 0,
          other_amount: 0,
          other_description: "",
        },
      },
    ),
  ]);

  await Promise.all([
    Announcement.createIndexes(),
    ServiceBill.createIndexes(),
    BillPaymentSubmission.createIndexes(),
  ]);
  console.log(JSON.stringify({ success: true, message: "V2 migration applied" }));
}

run()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
