const assert = require("node:assert/strict");
const test = require("node:test");
const {
  canResolveSos,
  canReviewSos,
  canSendSosWithoutRoom,
  getSosStatusFilter,
} = require("../src/utils/sosPolicy");

test("Admin and Staff can send SOS without a linked room", () => {
  assert.equal(canSendSosWithoutRoom("Admin"), true);
  assert.equal(canSendSosWithoutRoom("Staff"), true);
});

test("Resident and unauthenticated SOS still require a linked room", () => {
  assert.equal(canSendSosWithoutRoom("Resident"), false);
  assert.equal(canSendSosWithoutRoom("Security"), false);
  assert.equal(canSendSosWithoutRoom(undefined), false);
});

test("active and history SOS queue filters include the lifecycle states", () => {
  assert.deepEqual(getSosStatusFilter("active"), {
    $in: ["Pending", "Approved", "In Progress", "SOS_ACTIVE", "Active"],
  });
  assert.deepEqual(getSosStatusFilter("history"), {
    $in: ["Resolved", "Rejected"],
  });
  assert.deepEqual(getSosStatusFilter("Pending,Approved"), {
    $in: ["Pending", "Approved"],
  });
});

test("only pending alerts can be reviewed and only approved alerts can resolve", () => {
  assert.equal(canReviewSos("Pending"), true);
  assert.equal(canReviewSos("SOS_ACTIVE"), true);
  assert.equal(canReviewSos("Approved"), false);
  assert.equal(canResolveSos("Pending"), false);
  assert.equal(canResolveSos("Approved"), true);
  assert.equal(canResolveSos("In Progress"), true);
});
