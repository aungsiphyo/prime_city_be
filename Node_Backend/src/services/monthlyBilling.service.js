const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const Room = require("../models/Room");
const ServiceBill = require("../models/ServiceBill");
const { buildCategoryBillsForRoom } = require("./billCategory.service");
const { sendPushToUser } = require("./push.service");

const BILLING_TIME_ZONE = "Asia/Yangon";
const DEFAULT_SERVICE_FEE = 1_000;
const PAYMENT_WINDOW_DAYS = 7;
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

function getBillingPeriod(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("A valid billing date is required");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BILLING_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);

  return { year, month };
}

function buildMonthlyBillPayloads(room, options = {}) {
  if (!room?._id || !room?.resident_id || room.status !== "Occupied") {
    throw new Error("An occupied resident room is required");
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const { year, month } = options.period || getBillingPeriod(now);
  const serviceFee = Number(options.serviceFee ?? DEFAULT_SERVICE_FEE);
  if (!Number.isFinite(serviceFee) || serviceFee < 0) {
    throw new Error("serviceFee must be a non-negative number");
  }

  return buildCategoryBillsForRoom(
    {
      billing_month: month,
      billing_year: year,
      electricity_amount: 0,
      water_amount: 0,
      maintenance_amount: 0,
      service_amount: serviceFee,
      other_amount: 0,
    },
    room,
    { now },
  );
}

function emitToUser(app, userId, event, payload) {
  const io = app?.get?.("io");
  const onlineUsers = app?.get?.("onlineUsers") || {};
  const socketIds = onlineUsers[String(userId)];
  if (!io || !socketIds) return;

  io.to(Array.isArray(socketIds) ? socketIds : [socketIds]).emit(event, payload);
}

async function ensureMonthlyBillForRoom(roomOrId, options = {}) {
  const room = roomOrId?._id
    ? roomOrId
    : await Room.findById(roomOrId)
        .select(
          "_id room_name room_type status resident_id monthly_installment_amount installments_paid installment_status",
        )
        .lean();

  if (!room || room.status !== "Occupied" || !room.resident_id) {
    return { created: false, reason: "room-not-occupied" };
  }

  const payloads = buildMonthlyBillPayloads(room, options);
  const session = await mongoose.startSession();
  const createdPairs = [];

  try {
    await session.withTransaction(async () => {
      for (const payload of payloads) {
        const result = await ServiceBill.updateOne(
          { billing_key: payload.billing_key },
          { $setOnInsert: payload },
          {
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true,
            timestamps: false,
            session,
          },
        );

        if (result.upsertedCount !== 1) continue;

        const bill = await ServiceBill.findOne({
          billing_key: payload.billing_key,
        })
          .session(session)
          .lean();
        const [notification] = await Notification.create(
          [
            {
              user_id: room.resident_id,
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
        createdPairs.push({ bill, notification });
      }
    });
  } finally {
    await session.endSession();
  }

  const pushResults = [];
  for (const { bill, notification } of createdPairs) {
    emitToUser(options.app, room.resident_id, "bill_update", bill);
    emitToUser(options.app, room.resident_id, "notification", notification);
    try {
      pushResults.push(
        await sendPushToUser(room.resident_id, {
          title: notification.title,
          message: notification.message,
          type: notification.type,
          data: notification.data,
          notification_id: String(notification._id),
        }),
      );
    } catch (error) {
      pushResults.push({ success: false, error: error.message });
    }
  }

  return {
    created: createdPairs.length > 0,
    createdCount: createdPairs.length,
    existingCount: payloads.length - createdPairs.length,
    bills: createdPairs.map((item) => item.bill),
    notifications: createdPairs.map((item) => item.notification),
    pushResults,
    reason: createdPairs.length ? null : "already-exists",
  };
}

async function ensureCurrentMonthlyBills(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const period = getBillingPeriod(now);
  const rooms = await Room.find({
    status: "Occupied",
    resident_id: { $ne: null },
  })
    .select(
      "_id room_name room_type status resident_id monthly_installment_amount installments_paid installment_status",
    )
    .lean();

  const summary = {
    year: period.year,
    month: period.month,
    occupiedRooms: rooms.length,
    created: 0,
    existing: 0,
    roomsWithNewBills: 0,
    failed: 0,
  };

  for (const room of rooms) {
    try {
      const result = await ensureMonthlyBillForRoom(room, {
        ...options,
        now,
        period,
      });
      summary.created += result.createdCount || 0;
      summary.existing += result.existingCount || 0;
      if (result.created) summary.roomsWithNewBills += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(
        `Monthly billing failed for room ${String(room._id)}:`,
        error.message,
      );
    }
  }

  return summary;
}

let schedulerTimer = null;
let schedulerRunning = false;

function startMonthlyBillingScheduler(app, options = {}) {
  if (schedulerTimer) return schedulerTimer;

  const configuredInterval = Number(
    options.intervalMs ?? process.env.MONTHLY_BILLING_CHECK_INTERVAL_MS,
  );
  const intervalMs =
    Number.isFinite(configuredInterval) && configuredInterval >= 60_000
      ? configuredInterval
      : DEFAULT_CHECK_INTERVAL_MS;

  const run = async () => {
    if (schedulerRunning || mongoose.connection.readyState !== 1) return;
    schedulerRunning = true;
    try {
      const summary = await ensureCurrentMonthlyBills({ app });
      console.log("Monthly billing check:", JSON.stringify(summary));
    } catch (error) {
      console.error("Monthly billing scheduler failed:", error.message);
    } finally {
      schedulerRunning = false;
    }
  };

  void run();
  schedulerTimer = setInterval(run, intervalMs);
  schedulerTimer.unref?.();
  return schedulerTimer;
}

function stopMonthlyBillingScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerRunning = false;
}

module.exports = {
  BILLING_TIME_ZONE,
  DEFAULT_SERVICE_FEE,
  PAYMENT_WINDOW_DAYS,
  buildMonthlyBillPayloads,
  ensureCurrentMonthlyBills,
  ensureMonthlyBillForRoom,
  getBillingPeriod,
  startMonthlyBillingScheduler,
  stopMonthlyBillingScheduler,
};
