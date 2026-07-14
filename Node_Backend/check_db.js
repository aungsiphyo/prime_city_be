require("dotenv").config();
const mongoose = require("mongoose");
const Room = require("./src/models/Room");
const User = require("./src/models/User");

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const rooms = await Room.find().populate('resident_id');
  console.log("Rooms count:", rooms.length);
  for (let r of rooms) {
    console.log(`Room: ${r.room_name}, Resident: ${r.resident_id ? r.resident_id.fullname : 'NULL'}`);
  }
  process.exit(0);
}
check().catch(console.error);
