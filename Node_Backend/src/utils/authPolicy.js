const ASSIGNABLE_ROLES = new Set([
  "Resident",
  "Admin",
  "Staff",
  "Helper",
  "Security",
]);

function getPublicSignupRole() {
  return "Resident";
}

function normalizeAssignableRole(value) {
  const role = String(value || "").trim();
  return ASSIGNABLE_ROLES.has(role) ? role : null;
}

module.exports = {
  ASSIGNABLE_ROLES,
  getPublicSignupRole,
  normalizeAssignableRole,
};
