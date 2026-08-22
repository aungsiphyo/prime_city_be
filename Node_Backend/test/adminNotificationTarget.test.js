const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MAX_SELECTED_RESIDENTS,
  parseAdminNotificationTarget,
} = require("../src/services/adminNotificationTarget.service");

test("All residents remains a supported notification target", () => {
  assert.deepEqual(
    parseAdminNotificationTarget({ target: "all_residents" }),
    { mode: "all_residents", recipientIds: [] },
  );
});

test("one selected resident keeps the existing single-recipient behavior", () => {
  assert.deepEqual(
    parseAdminNotificationTarget({
      target: "resident",
      recipient_user_id: "507f1f77bcf86cd799439011",
    }),
    {
      mode: "resident",
      recipientIds: ["507f1f77bcf86cd799439011"],
    },
  );
});

test("multiple selected residents are de-duplicated without becoming All residents", () => {
  assert.deepEqual(
    parseAdminNotificationTarget({
      target: "selected_residents",
      recipient_user_ids: [
        "507f1f77bcf86cd799439011",
        "507f191e810c19729de860ea",
        "507f1f77bcf86cd799439011",
      ],
    }),
    {
      mode: "selected_residents",
      recipientIds: [
        "507f1f77bcf86cd799439011",
        "507f191e810c19729de860ea",
      ],
    },
  );
});

test("selected-resident sends require at least one recipient", () => {
  assert.throws(
    () =>
      parseAdminNotificationTarget({
        target: "selected_residents",
        recipient_user_ids: [],
      }),
    /Select at least one resident/,
  );
});

test("selected-resident sends have a bounded batch size", () => {
  assert.throws(
    () =>
      parseAdminNotificationTarget({
        target: "selected_residents",
        recipient_user_ids: Array.from(
          { length: MAX_SELECTED_RESIDENTS + 1 },
          (_, index) => `resident-${index}`,
        ),
      }),
    /Select no more than/,
  );
});
