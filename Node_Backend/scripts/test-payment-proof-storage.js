require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  deletePaymentProof,
  findPaymentProof,
  openPaymentProof,
  uploadPaymentProof,
} = require("../src/services/paymentProof.service");

const testDbName = String(process.env.E2E_TEST_DB_NAME || "");

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function run() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (!/^prime_city_[a-z0-9_]+_test$/i.test(testDbName)) {
    throw new Error("E2E_TEST_DB_NAME must be an isolated prime_city_*_test database");
  }

  await mongoose.connect(process.env.MONGO_URI, { dbName: testDbName });
  const source = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
  ]);
  let fileId = null;

  try {
    fileId = await uploadPaymentProof({
      buffer: source,
      mime: "image/png",
      billId: new mongoose.Types.ObjectId(),
      roomId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
    });
    const metadata = await findPaymentProof(fileId);
    assert.ok(metadata);
    assert.equal(metadata.metadata.mime, "image/png");
    assert.equal(metadata.metadata.purpose, "bill_payment_proof");
    assert.deepEqual(await readStream(openPaymentProof(fileId)), source);
    await deletePaymentProof(fileId);
    fileId = null;
    console.log(JSON.stringify({ success: true, storage: "MongoGridFS" }));
  } finally {
    if (fileId) await deletePaymentProof(fileId).catch(() => {});
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
