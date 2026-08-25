const ROOM_OPTIONAL_SOS_ROLES = new Set(["Admin", "Staff"]);

function canSendSosWithoutRoom(role) {
  return ROOM_OPTIONAL_SOS_ROLES.has(role);
}

module.exports = {
  canSendSosWithoutRoom,
};
