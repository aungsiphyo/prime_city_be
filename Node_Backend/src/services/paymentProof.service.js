const crypto = require("crypto");
const mongoose = require("mongoose");

const BUCKET_NAME = "bill_payment_proofs";

function getBucket() {
  if (!mongoose.connection.db) {
    throw new Error("Database is not ready for payment proof storage");
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: BUCKET_NAME,
  });
}

function extensionForMime(mime) {
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return ".jpg";
}

function uploadPaymentProof({ buffer, mime, billId, roomId, userId }) {
  return new Promise((resolve, reject) => {
    const bucket = getBucket();
    const stream = bucket.openUploadStream(
      `${crypto.randomUUID()}${extensionForMime(mime)}`,
      {
        contentType: mime,
        metadata: {
          purpose: "bill_payment_proof",
          mime,
          bill_id: new mongoose.Types.ObjectId(String(billId)),
          room_id: new mongoose.Types.ObjectId(String(roomId)),
          user_id: new mongoose.Types.ObjectId(String(userId)),
        },
      },
    );
    stream.once("error", reject);
    stream.once("finish", () => resolve(stream.id));
    stream.end(buffer);
  });
}

async function deletePaymentProof(fileId) {
  if (!fileId) return;
  try {
    await getBucket().delete(new mongoose.Types.ObjectId(String(fileId)));
  } catch (error) {
    if (error.code !== "ENOENT" && error.message !== "File not found") throw error;
  }
}

async function findPaymentProof(fileId) {
  if (!fileId) return null;
  return getBucket()
    .find({ _id: new mongoose.Types.ObjectId(String(fileId)) })
    .next();
}

function openPaymentProof(fileId) {
  return getBucket().openDownloadStream(
    new mongoose.Types.ObjectId(String(fileId)),
  );
}

module.exports = {
  BUCKET_NAME,
  deletePaymentProof,
  findPaymentProof,
  openPaymentProof,
  uploadPaymentProof,
};
