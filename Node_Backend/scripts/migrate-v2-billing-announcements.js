require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const Announcement = require("../src/models/Announcement");
const BillPaymentSubmission = require("../src/models/BillPaymentSubmission");
const Room = require("../src/models/Room");
const ServiceBill = require("../src/models/ServiceBill");
const {
  ROOM_PRICES,
  calculatePropertyFinance,
} = require("../src/services/propertyFinance.service");

const apply = process.argv.includes("--apply");

async function run() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);

  const [legacyAnnouncements, legacyBills, roomsMissingFinance] = await Promise.all([
    Announcement.countDocuments({
      $or: [
        { status: { $exists: false } },
        { audience_type: { $exists: false } },
      ],
    }),
    ServiceBill.countDocuments({ electricity_amount: { $exists: false } }),
    Room.countDocuments({
      $or: [
        { purchase_price: { $exists: false } },
        { purchase_price: { $lte: 0 } },
        { monthly_installment_amount: { $exists: false } },
        { monthly_installment_amount: { $lte: 0 } },
      ],
    }),
  ]);

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      legacyAnnouncements,
      legacyBills,
      roomsMissingFinance,
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
    ServiceBill.updateMany(
      { payment_window_days: { $exists: false } },
      {
        $set: {
          payment_window_days: 7,
          service_cutoff_warning:
            "Pay within 7 days. Electricity and water services may be suspended after the due date if this bill remains unpaid.",
          installment_applied: false,
        },
      },
    ),
  ]);

  for (const roomType of Object.keys(ROOM_PRICES)) {
    const finance = calculatePropertyFinance(roomType);
    await Room.updateMany(
      {
        room_type: roomType,
        $or: [
          { purchase_price: { $exists: false } },
          { purchase_price: { $lte: 0 } },
          { monthly_installment_amount: { $exists: false } },
          { monthly_installment_amount: { $lte: 0 } },
        ],
      },
      [
        {
          $set: {
            purchase_price: {
              $cond: [
                { $gt: [{ $ifNull: ["$purchase_price", 0] }, 0] },
                "$purchase_price",
                finance.purchase_price,
              ],
            },
            down_payment_percent: {
              $ifNull: ["$down_payment_percent", finance.down_payment_percent],
            },
            down_payment_amount: {
              $cond: [
                { $gt: [{ $ifNull: ["$down_payment_amount", 0] }, 0] },
                "$down_payment_amount",
                finance.down_payment_amount,
              ],
            },
            financed_amount: {
              $cond: [
                { $gt: [{ $ifNull: ["$financed_amount", 0] }, 0] },
                "$financed_amount",
                finance.financed_amount,
              ],
            },
            installment_months: {
              $ifNull: ["$installment_months", finance.installment_months],
            },
            monthly_installment_amount: {
              $cond: [
                {
                  $gt: [
                    { $ifNull: ["$monthly_installment_amount", 0] },
                    0,
                  ],
                },
                "$monthly_installment_amount",
                finance.monthly_installment_amount,
              ],
            },
            installments_paid: { $ifNull: ["$installments_paid", 0] },
            installment_remaining_amount: {
              $cond: [
                {
                  $gt: [
                    { $ifNull: ["$installment_remaining_amount", 0] },
                    0,
                  ],
                },
                "$installment_remaining_amount",
                {
                  $max: [
                    0,
                    {
                      $subtract: [
                        finance.financed_amount,
                        {
                          $multiply: [
                            { $ifNull: ["$installments_paid", 0] },
                            finance.monthly_installment_amount,
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            down_payment_status: { $ifNull: ["$down_payment_status", "Paid"] },
            installment_status: {
              $cond: [
                {
                  $gte: [
                    { $ifNull: ["$installments_paid", 0] },
                    finance.installment_months,
                  ],
                },
                "Paid",
                { $ifNull: ["$installment_status", "Active"] },
              ],
            },
          },
        },
      ],
    );
  }

  await Promise.all([
    Announcement.createIndexes(),
    ServiceBill.createIndexes(),
    BillPaymentSubmission.createIndexes(),
    Room.createIndexes(),
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
