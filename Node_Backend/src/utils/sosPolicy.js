const ROOM_OPTIONAL_SOS_ROLES = new Set(["Admin", "Staff"]);
const ACTIVE_SOS_STATUSES = Object.freeze([
  "Pending",
  "Approved",
  "In Progress",
  "SOS_ACTIVE",
  "Active",
]);
const HISTORY_SOS_STATUSES = Object.freeze(["Resolved", "Rejected"]);
const REVIEWABLE_SOS_STATUSES = Object.freeze(["Pending", "SOS_ACTIVE"]);
const RESOLVABLE_SOS_STATUSES = Object.freeze([
  "Approved",
  "In Progress",
  "Active",
]);

function canSendSosWithoutRoom(role) {
  return ROOM_OPTIONAL_SOS_ROLES.has(role);
}

function getSosStatusFilter(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;

  if (normalized.toLowerCase() === "active") {
    return { $in: ACTIVE_SOS_STATUSES };
  }

  if (normalized.toLowerCase() === "history") {
    return { $in: HISTORY_SOS_STATUSES };
  }

  const statuses = normalized
    .split(",")
    .map((status) => status.trim())
    .filter(Boolean);

  if (statuses.length === 1) return statuses[0];
  return statuses.length ? { $in: statuses } : null;
}

function canReviewSos(status) {
  return REVIEWABLE_SOS_STATUSES.includes(status);
}

function canResolveSos(status) {
  return RESOLVABLE_SOS_STATUSES.includes(status);
}

module.exports = {
  ACTIVE_SOS_STATUSES,
  HISTORY_SOS_STATUSES,
  REVIEWABLE_SOS_STATUSES,
  RESOLVABLE_SOS_STATUSES,
  canResolveSos,
  canReviewSos,
  canSendSosWithoutRoom,
  getSosStatusFilter,
};
