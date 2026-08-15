require("dotenv").config();

const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const BillPaymentSubmission = require("../src/models/BillPaymentSubmission");
const Notification = require("../src/models/Notification");
const Room = require("../src/models/Room");
const ServiceBill = require("../src/models/ServiceBill");
const User = require("../src/models/User");
const { ensureMonthlyBillForRoom } = require("../src/services/monthlyBilling.service");
const { calculatePropertyFinance } = require("../src/services/propertyFinance.service");

function authHeader(user) {
  return {
    Authorization: `Bearer ${jwt.sign(
      { id: String(user._id), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "10m" },
    )}`,
  };
}

async function readJson(response) {
  const body = await response.json();
  assert.equal(
    response.ok,
    true,
    `${response.status} ${body.message || JSON.stringify(body)}`,
  );
  return body;
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  process.env.JWT_SECRET ||= "prime-city-category-e2e-secret";

  const databaseName = `pc_category_e2e_${Date.now()}`;
  let server;

  try {
    await mongoose.connect(process.env.MONGO_URI, { dbName: databaseName });

    const [resident, otherResident, admin] = await User.create([
      {
        fullname: "Category Test Resident",
        email: `category-resident-${Date.now()}@example.test`,
        phone: "09000000001",
        password: "temporary-password",
        role: "Resident",
      },
      {
        fullname: "Other Test Resident",
        email: `category-other-${Date.now()}@example.test`,
        phone: "09000000002",
        password: "temporary-password",
        role: "Resident",
      },
      {
        fullname: "Category Test Admin",
        email: `category-admin-${Date.now()}@example.test`,
        phone: "09000000003",
        password: "temporary-password",
        role: "Admin",
      },
    ]);

    const finance = calculatePropertyFinance("Standard");
    const room = await Room.create({
      room_name: "E2E-CATEGORY-01",
      building: "E2E",
      floor: 1,
      room_type: "Standard",
      status: "Occupied",
      resident_id: resident._id,
      owner_name: resident.fullname,
      ...finance,
      installments_paid: 0,
      installment_status: "Active",
    });

    const firstGeneration = await ensureMonthlyBillForRoom(room.toObject(), {
      now: new Date("2026-08-15T12:00:00+06:30"),
      period: { year: 2026, month: 8 },
    });
    assert.equal(firstGeneration.createdCount, 2);
    const secondGeneration = await ensureMonthlyBillForRoom(room.toObject(), {
      now: new Date("2026-08-15T12:00:00+06:30"),
      period: { year: 2026, month: 8 },
    });
    assert.equal(secondGeneration.createdCount, 0);
    assert.equal(secondGeneration.existingCount, 2);

    const generatedBills = await ServiceBill.find({ room_id: room._id })
      .sort({ category: 1 })
      .lean();
    assert.deepEqual(
      generatedBills.map((bill) => bill.category),
      ["Apartment Installment", "Service Fee"],
    );
    const installmentBill = generatedBills.find(
      (bill) => bill.category === "Apartment Installment",
    );
    const serviceBill = generatedBills.find(
      (bill) => bill.category === "Service Fee",
    );
    assert.equal(installmentBill.amount, 2_000_000);
    assert.equal(installmentBill.service_amount, 0);
    assert.equal(serviceBill.amount, 1_000);
    assert.equal(serviceBill.installment_amount, 0);

    const app = express();
    app.use(express.json());
    app.set("onlineUsers", {});
    app.use("/api/bills", require("../src/routes/serviceBill"));
    app.use("/api/bill-payments", require("../src/routes/billPayment"));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const residentBillsResponse = await fetch(`${baseUrl}/api/bills`, {
      headers: authHeader(resident),
    });
    const residentBills = await readJson(residentBillsResponse);
    assert.equal(residentBills.data.length, 2);
    assert.deepEqual(
      residentBills.data.map((bill) => bill.category).sort(),
      ["Apartment Installment", "Service Fee"],
    );

    const privateBillResponse = await fetch(
      `${baseUrl}/api/bills/${serviceBill._id}`,
      { headers: authHeader(otherResident) },
    );
    assert.equal(privateBillResponse.status, 404);

    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
      0x00,
    ]);
    const servicePaymentForm = new FormData();
    servicePaymentForm.set("submitted_amount", String(serviceBill.amount));
    servicePaymentForm.set(
      "screenshot",
      new Blob([png], { type: "image/png" }),
      "service-fee.png",
    );
    const submitResponse = await fetch(
      `${baseUrl}/api/bill-payments/${serviceBill._id}/submit`,
      {
        method: "POST",
        headers: authHeader(resident),
        body: servicePaymentForm,
      },
    );
    const submitted = await readJson(submitResponse);

    const managerQueueResponse = await fetch(`${baseUrl}/api/bill-payments`, {
      headers: authHeader(admin),
    });
    const managerQueue = await readJson(managerQueueResponse);
    assert.equal(managerQueue.data[0].room_id.room_name, room.room_name);
    assert.equal(managerQueue.data[0].bill_id.category, "Service Fee");

    const proofWithoutToken = await fetch(
      `${baseUrl}/api${managerQueue.data[0].proof_url}`,
    );
    assert.equal(proofWithoutToken.status, 401);
    const proofResponse = await fetch(
      `${baseUrl}/api${managerQueue.data[0].proof_url}`,
      { headers: authHeader(admin) },
    );
    assert.equal(proofResponse.status, 200);
    assert.deepEqual(Buffer.from(await proofResponse.arrayBuffer()), png);

    const approveServiceResponse = await fetch(
      `${baseUrl}/api/bill-payments/${submitted.data._id}/review`,
      {
        method: "POST",
        headers: { ...authHeader(admin), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      },
    );
    await readJson(approveServiceResponse);

    const residentHistoryResponse = await fetch(
      `${baseUrl}/api/bill-payments/mine?limit=100`,
      { headers: authHeader(resident) },
    );
    const residentHistory = await readJson(residentHistoryResponse);
    assert.equal(residentHistory.data.length, 1);
    assert.equal(residentHistory.data[0].status, "Approved");
    assert.equal(residentHistory.data[0].bill_id.category, "Service Fee");
    assert.equal(residentHistory.data[0].room_id.room_name, room.room_name);
    assert.equal(Boolean(residentHistory.data[0].submitted_at), true);
    assert.equal(Boolean(residentHistory.data[0].reviewed_at), true);

    const residentProofResponse = await fetch(
      `${baseUrl}/api${residentHistory.data[0].proof_url}`,
      { headers: authHeader(resident) },
    );
    assert.equal(residentProofResponse.status, 200);
    const otherResidentProofResponse = await fetch(
      `${baseUrl}/api${residentHistory.data[0].proof_url}`,
      { headers: authHeader(otherResident) },
    );
    assert.equal(otherResidentProofResponse.status, 403);

    const [approvedService, pendingInstallment, unchangedRoom] =
      await Promise.all([
        ServiceBill.findById(serviceBill._id).lean(),
        ServiceBill.findById(installmentBill._id).lean(),
        Room.findById(room._id).lean(),
      ]);
    assert.equal(approvedService.status, "Paid");
    assert.equal(pendingInstallment.status, "Pending");
    assert.equal(unchangedRoom.installments_paid, 0);

    const adminNotification = await Notification.findOne({
      user_id: admin._id,
      "data.payment_submission_id": String(submitted.data._id),
    }).lean();
    assert.equal(adminNotification.data.room_name, room.room_name);
    assert.equal(adminNotification.data.bill_category, "Service Fee");
    assert.match(adminNotification.message, /Room E2E-CATEGORY-01/);
    assert.match(adminNotification.message, /Service Fee/);

    const residentApproval = await Notification.findOne({
      user_id: resident._id,
      "data.payment_submission_id": String(submitted.data._id),
      "data.payment_status": "Approved",
    }).lean();
    assert.equal(residentApproval.data.bill_category, "Service Fee");

    const activeSubmission = await BillPaymentSubmission.findOne({
      bill_id: serviceBill._id,
    }).lean();
    assert.equal(activeSubmission.status, "Approved");
    assert.equal(activeSubmission.is_active, false);

    console.log(
      JSON.stringify({
        success: true,
        generatedCategories: generatedBills.map((bill) => bill.category),
        duplicateGenerationPrevented: true,
        residentScopeProtected: true,
        privateProofProtected: true,
        adminSawRoom: managerQueue.data[0].room_id.room_name,
        adminSawCategory: managerQueue.data[0].bill_id.category,
        residentPaymentHistory: residentHistory.data.length,
        residentProofOwnershipProtected: true,
        paidCategory: approvedService.category,
        otherCategoryStatus: pendingInstallment.status,
        installmentProgressUnchanged: unchangedRoom.installments_paid === 0,
      }),
    );
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose.connection.readyState) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
