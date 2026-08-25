const assert = require("node:assert/strict");
const test = require("node:test");
const { canSendSosWithoutRoom } = require("../src/utils/sosPolicy");

test("Admin and Staff can send SOS without a linked room", () => {
  assert.equal(canSendSosWithoutRoom("Admin"), true);
  assert.equal(canSendSosWithoutRoom("Staff"), true);
});

test("Resident and unauthenticated SOS still require a linked room", () => {
  assert.equal(canSendSosWithoutRoom("Resident"), false);
  assert.equal(canSendSosWithoutRoom("Security"), false);
  assert.equal(canSendSosWithoutRoom(undefined), false);
});
