const { randomUUID } = require("crypto");

const UID_PREFIXES = Object.freeze({
  RESIDENT: "RES",
  VISITOR: "VIS",
});

function generateResidentUid() {
  return `${UID_PREFIXES.RESIDENT}-${randomUUID()}`;
}

function generateVisitorUid() {
  return `${UID_PREFIXES.VISITOR}-${randomUUID()}`;
}

module.exports = {
  UID_PREFIXES,
  generateResidentUid,
  generateVisitorUid,
};
