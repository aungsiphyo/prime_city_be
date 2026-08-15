require("dotenv").config();

const mongoose = require("mongoose");
const BillPaymentSubmission = require("../src/models/BillPaymentSubmission");
const Notification = require("../src/models/Notification");
const Room = require("../src/models/Room");
const ServiceBill = require("../src/models/ServiceBill");
const { buildBillingKey } = require("../src/services/billing.service");
const { sendPushToUser } = require("../src/services/push.service");

const COMPONENTS = Object.freeze([
  {
    category: "Apartment Installment",
    field: "installment_amount",
    type: "Installment",
  },
  { category: "Electricity", field: "electricity_amount", type: "Electricity" },
  { category: "Water", field: "water_amount", type: "Water" },
  {
    category: "Maintenance",
    field: "maintenance_amount",
    type: "Maintenance",
  },
  { category: "Service Fee", field: "service_amount", type: "Service" },
  { category: "Other", field: "other_amount", type: "Other" },
]);

function readArgument(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? Number(match.slice(prefix.length)) : fallback;
}

function monthName(year, month) {
  return new Intl.DateTimeFormat("en-US", { month: "long" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

function warningFor(category, dueDate) {
  const formattedDate = new Date(dueDate).toLocaleDateString("en-GB");
  if (["Electricity", "Water"].includes(category)) {
    return `${category} must be paid by ${formattedDate}. The related service may be suspended after the due date while this category remains unpaid.`;
  }
  return `${category} must be paid by ${formattedDate}. This category can be paid separately from the resident's other bills.`;
}

function categoryDocument(source, component, year, month, now) {
  const amount = Number(source[component.field] || 0);
  const result = {
    ...source,
    title: `${monthName(year, month)} ${year} ${component.category}`,
    type: component.type,
    category: component.category,
    billing_key: buildBillingKey(
      source.room_id,
      year,
      month,
      component.category,
    ),
    electricity_amount: 0,
    water_amount: 0,
    installment_amount: 0,
    maintenance_amount: 0,
    service_amount: 0,
    other_amount: 0,
    other_description:
      component.category === "Other" ? source.other_description || "" : "",
    service_cutoff_warning: warningFor(component.category, source.due_date),
    installment_applied: false,
    amount,
    updated_at: now,
  };
  result[component.field] = amount;
  return result;
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");

  const apply = process.argv.includes("--apply");
  const year = readArgument("year", 2026);
  const month = readArgument("month", 8);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("--year and --month must be a valid billing period");
  }

  await mongoose.connect(
    process.env.MONGO_URI,
    process.env.MONGO_DB_NAME
      ? { dbName: process.env.MONGO_DB_NAME.trim() }
      : undefined,
  );

  try {
    const combinedBills = await ServiceBill.collection
      .find({
        billing_year: year,
        billing_month: month,
        status: "Pending",
        $or: [
          { category: { $exists: false } },
          { category: null },
          { category: "Combined" },
        ],
      })
      .toArray();
    const sourceIds = combinedBills.map((bill) => bill._id);
    const paymentSubmissionCount = sourceIds.length
      ? await BillPaymentSubmission.countDocuments({ bill_id: { $in: sourceIds } })
      : 0;
    const missingResidentCount = combinedBills.filter(
      (bill) => !bill.room_id || !bill.resident_user_id,
    ).length;
    const categoryDocuments = combinedBills.flatMap((bill) =>
      COMPONENTS.filter((component) => Number(bill[component.field] || 0) > 0).map(
        (component) => categoryDocument(bill, component, year, month, new Date()),
      ),
    );
    const expectedKeys = categoryDocuments.map((bill) => bill.billing_key);
    const conflictingKeys = expectedKeys.length
      ? await ServiceBill.countDocuments({ billing_key: { $in: expectedKeys } })
      : 0;

    const summary = {
      mode: apply ? "apply" : "dry-run",
      billingPeriod: `${year}-${String(month).padStart(2, "0")}`,
      combinedBills: combinedBills.length,
      categoryBillsAfterSplit: categoryDocuments.length,
      categories: categoryDocuments.reduce((counts, bill) => {
        counts[bill.category] = (counts[bill.category] || 0) + 1;
        return counts;
      }, {}),
      paymentSubmissions: paymentSubmissionCount,
      missingResidentLinks: missingResidentCount,
      conflictingCategoryKeys: conflictingKeys,
      totalBefore: combinedBills.reduce(
        (sum, bill) => sum + Number(bill.amount || 0),
        0,
      ),
      totalAfter: categoryDocuments.reduce(
        (sum, bill) => sum + Number(bill.amount || 0),
        0,
      ),
    };

    console.log(JSON.stringify(summary));
    if (!apply || !combinedBills.length) return;
    if (paymentSubmissionCount) {
      throw new Error("Migration stopped: a combined bill has payment history");
    }
    if (missingResidentCount) {
      throw new Error("Migration stopped: a combined bill is missing its resident link");
    }
    if (conflictingKeys) {
      throw new Error("Migration stopped: category billing keys already exist");
    }
    if (summary.totalBefore !== summary.totalAfter) {
      throw new Error("Migration stopped: category totals do not match source totals");
    }

    const occupiedRooms = await Room.countDocuments({
      _id: { $in: combinedBills.map((bill) => bill.room_id) },
      status: "Occupied",
      resident_id: { $ne: null },
    });
    if (occupiedRooms !== combinedBills.length) {
      throw new Error("Migration stopped: every source bill must belong to an occupied room");
    }

    const session = await mongoose.startSession();
    const newNotifications = [];
    try {
      await session.withTransaction(async () => {
        const archivedAt = new Date();
        await mongoose.connection.collection("servicebill_archives").insertMany(
          combinedBills.map((bill) => ({
            source_bill_id: bill._id,
            archive_reason: "split_into_separate_category_bills",
            archived_at: archivedAt,
            snapshot: bill,
          })),
          { session },
        );

        for (const source of combinedBills) {
          const splitDocuments = COMPONENTS.filter(
            (component) => Number(source[component.field] || 0) > 0,
          ).map((component) =>
            categoryDocument(source, component, year, month, archivedAt),
          );
          const [first, ...additional] = splitDocuments;
          const sourceId = source._id;
          delete first._id;
          await ServiceBill.collection.updateOne(
            { _id: sourceId, status: "Pending" },
            { $set: first },
            { session },
          );

          for (const document of additional) delete document._id;
          const createdAdditional = additional.length
            ? await ServiceBill.insertMany(additional, { session })
            : [];

          await Notification.updateMany(
            {
              user_id: source.resident_user_id,
              $or: [
                { "data.bill_id": String(sourceId) },
                { "data.bill_id": sourceId },
              ],
            },
            {
              $set: {
                title: `New ${first.category} bill`,
                message: `${first.title}: ${first.amount} MMK is due on ${new Date(
                  first.due_date,
                ).toLocaleDateString("en-GB")}. Pay this category separately.`,
                "data.bill_status": first.status,
                "data.bill_category": first.category,
              },
            },
            { session },
          );

          for (const bill of createdAdditional) {
            const [notification] = await Notification.create(
              [
                {
                  user_id: source.resident_user_id,
                  title: `New ${bill.category} bill`,
                  message: `${bill.title}: ${bill.amount} MMK is due on ${new Date(
                    bill.due_date,
                  ).toLocaleDateString("en-GB")}. Pay this category separately.`,
                  type: "General",
                  data: {
                    bill_id: String(bill._id),
                    bill_status: bill.status,
                    bill_category: bill.category,
                  },
                },
              ],
              { session },
            );
            newNotifications.push(notification.toObject());
          }
        }
      });
    } finally {
      await session.endSession();
    }

    const pushResults = [];
    for (const notification of newNotifications) {
      pushResults.push(
        await sendPushToUser(notification.user_id, {
          title: notification.title,
          message: notification.message,
          type: notification.type,
          data: notification.data,
          notification_id: String(notification._id),
        }),
      );
    }

    const verification = {
      remainingCombinedBills: await ServiceBill.countDocuments({
        billing_year: year,
        billing_month: month,
        category: "Combined",
      }),
      categoryBills: await ServiceBill.countDocuments({
        billing_year: year,
        billing_month: month,
        category: { $in: COMPONENTS.map((component) => component.category) },
      }),
      archivedSnapshots: await mongoose.connection
        .collection("servicebill_archives")
        .countDocuments({
          source_bill_id: { $in: sourceIds },
          archive_reason: "split_into_separate_category_bills",
        }),
      notificationsCreated: newNotifications.length,
      pushesSuccessful: pushResults.filter((result) => result.success).length,
      pushesSkipped: pushResults.filter((result) => result.skipped).length,
      pushesFailed: pushResults.filter(
        (result) => !result.success && !result.skipped,
      ).length,
    };
    console.log(JSON.stringify({ applied: true, verification }));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
