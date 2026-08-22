const MAX_SELECTED_RESIDENTS = 1000;

function targetError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function parseAdminNotificationTarget(body = {}) {
  const sendToAllResidents =
    body.target === "all" ||
    body.target === "all_residents" ||
    body.user_id === "all" ||
    body.recipient_user_id === "all";

  if (sendToAllResidents) {
    return { mode: "all_residents", recipientIds: [] };
  }

  const submittedIds = Array.isArray(body.recipient_user_ids)
    ? body.recipient_user_ids
    : [body.recipient_user_id || body.user_id];
  const recipientIds = Array.from(
    new Set(
      submittedIds
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

  if (!recipientIds.length) {
    throw targetError("Select at least one resident");
  }
  if (recipientIds.length > MAX_SELECTED_RESIDENTS) {
    throw targetError(
      `Select no more than ${MAX_SELECTED_RESIDENTS} residents at a time`,
    );
  }

  return {
    mode: recipientIds.length === 1 ? "resident" : "selected_residents",
    recipientIds,
  };
}

module.exports = {
  MAX_SELECTED_RESIDENTS,
  parseAdminNotificationTarget,
};
