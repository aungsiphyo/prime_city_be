const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyIntent } = require("../src/services/intent.service");
const { applyHonorific } = require("../src/services/ai.service");
const { getAdminContact } = require("../src/services/aiTools.service");
const aiTools = require("../src/services/aiTools.service");
const User = require("../src/models/User");
const Room = require("../src/models/Room");
const ServiceBill = require("../src/models/ServiceBill");
const Visitor = require("../src/models/Visitor");

function queryResult(value) {
  const chain = {
    select: () => chain,
    sort: () => chain,
    limit: () => chain,
    lean: async () => value,
  };
  return chain;
}

test("bill questions always use the authenticated user's bill tool", () => {
  const intent = classifyIntent("အခုလ ကျွန်တော့် bill ဘယ်လောက်ရှိလဲ");
  assert.equal(intent.toolName, "getMyBills");
});

test("resident population questions use aggregate database tool", () => {
  const intent = classifyIntent("Prime City မှာ နေထိုင်သူ ဦးရေ ဘယ်လောက်ရှိလဲ");
  assert.equal(intent.toolName, "getResidentPopulation");
});

test("Myanmar room-count wording uses live room availability totals", () => {
  const intent = classifyIntent("Prime City မှာ အခန်း ဘယ်နှခန်းရှိလဲ");
  assert.equal(intent.toolName, "getRoomAvailability");
});

test("weather questions use live weather tool", () => {
  const intent = classifyIntent("ဒီနေ့ ရာသီဥတု ဘယ်လိုလဲ");
  assert.equal(intent.toolName, "getWeather");
});

test("admin contact returns only configured public phone numbers", () => {
  const original = process.env.ADMIN_CONTACT_PHONES;
  delete process.env.ADMIN_CONTACT_PHONES;
  assert.deepEqual(getAdminContact().phones, ["09455507081", "09965139303"]);
  if (original === undefined) delete process.env.ADMIN_CONTACT_PHONES;
  else process.env.ADMIN_CONTACT_PHONES = original;
});

test("Myanmar honorific stays consistent", () => {
  assert.equal(applyHonorific("ကူညီပေးနိုင်ပါတယ်။", "shin"), "ရှင်၊ ကူညီပေးနိုင်ပါတယ်။");
  assert.equal(applyHonorific("ကူညီပေးနိုင်ပါတယ်။", "khinbya"), "ခင်ဗျာ၊ ကူညီပေးနိုင်ပါတယ်။");
  assert.equal(applyHonorific("ရှင်၊ သိမ်းပြီးပါပြီ။", "shin"), "ရှင်၊ သိမ်းပြီးပါပြီ။");
});

test("bill tool ignores a caller-supplied room and queries only the authenticated room", async () => {
  const userId = "64b000000000000000000001";
  const ownRoomId = "64b000000000000000000002";
  const originalFindUser = User.findById;
  const originalFindRoom = Room.findOne;
  const originalFindBill = ServiceBill.find;
  const capturedFilters = [];

  User.findById = () => queryResult({
    _id: userId,
    fullname: "Test Resident",
    role: "Resident",
    room_id: ownRoomId,
  });
  Room.findOne = () => queryResult({
    _id: ownRoomId,
    room_name: "A101",
    status: "Occupied",
  });
  ServiceBill.find = (filter) => {
    capturedFilters.push(filter);
    return queryResult([]);
  };

  try {
    await aiTools.getMyBills(
      { _id: userId },
      { room_id: "64b000000000000000000099", user_id: "other-user" },
    );
    assert.ok(capturedFilters.length >= 3);
    capturedFilters.forEach((filter) => {
      assert.equal(String(filter.room_id), ownRoomId);
    });
  } finally {
    User.findById = originalFindUser;
    Room.findOne = originalFindRoom;
    ServiceBill.find = originalFindBill;
  }
});

test("visitor AI history is scoped to authenticated user and room", async () => {
  const userId = "64b000000000000000000011";
  const ownRoomId = "64b000000000000000000012";
  const originalFindUser = User.findById;
  const originalFindRoom = Room.findOne;
  const originalFindVisitor = Visitor.find;
  let capturedFilter = null;

  User.findById = () => queryResult({
    _id: userId,
    fullname: "Test Resident",
    role: "Resident",
    room_id: ownRoomId,
  });
  Room.findOne = () => queryResult({ _id: ownRoomId, room_name: "B202" });
  Visitor.find = (filter) => {
    capturedFilter = filter;
    return queryResult([]);
  };

  try {
    await aiTools.getMyVisitors({ _id: userId });
    assert.equal(String(capturedFilter.target_room_id), ownRoomId);
    assert.equal(String(capturedFilter.registered_by), userId);
  } finally {
    User.findById = originalFindUser;
    Room.findOne = originalFindRoom;
    Visitor.find = originalFindVisitor;
  }
});
