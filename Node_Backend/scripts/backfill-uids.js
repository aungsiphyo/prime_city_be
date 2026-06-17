require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../src/models/User");
const Visitor = require("../src/models/Visitor");
const {
  generateResidentUid,
  generateVisitorUid,
} = require("../src/utils/generateUid");

function missingUidFilter(field) {
  return {
    $or: [
      { [field]: { $exists: false } },
      { [field]: null },
      { [field]: "" },
    ],
  };
}

async function createUniqueUid(Model, field, generateUid) {
  let uid;
  let exists;

  do {
    uid = generateUid();
    exists = await Model.exists({ [field]: uid });
  } while (exists);

  return uid;
}

async function backfillModel(Model, field, generateUid) {
  const filter = missingUidFilter(field);
  const docs = Model.find(filter).select("_id").cursor();
  let updated = 0;

  for await (const doc of docs) {
    const uid = await createUniqueUid(Model, field, generateUid);
    const result = await Model.collection.updateOne(
      { _id: doc._id, ...missingUidFilter(field) },
      { $set: { [field]: uid } },
    );

    updated += result.modifiedCount || 0;
  }

  return updated;
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required to backfill UIDs.");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const residentCount = await backfillModel(
    User,
    "resident_uid",
    generateResidentUid,
  );
  const visitorCount = await backfillModel(
    Visitor,
    "visitor_uid",
    generateVisitorUid,
  );

  await User.createIndexes();
  await Visitor.createIndexes();

  console.log(
    `Backfilled ${residentCount} resident UID(s) and ${visitorCount} visitor UID(s).`,
  );
}

main()
  .catch((err) => {
    console.error("UID backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
