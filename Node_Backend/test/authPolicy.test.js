const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getPublicSignupRole,
  normalizeAssignableRole,
} = require("../src/utils/authPolicy");

test("public signup can never self-assign a privileged role", () => {
  assert.equal(getPublicSignupRole("Admin"), "Resident");
  assert.equal(getPublicSignupRole("Staff"), "Resident");
});

test("Admin role assignment accepts only User schema roles", () => {
  assert.equal(normalizeAssignableRole("Admin"), "Admin");
  assert.equal(normalizeAssignableRole("Resident"), "Resident");
  assert.equal(normalizeAssignableRole("SuperAdmin"), null);
});
