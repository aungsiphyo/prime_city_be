require("dotenv").config();
const mongoose = require("mongoose");
const ServiceBill = require("./src/models/ServiceBill");
const Room = require("./src/models/Room");
const User = require("./src/models/User");

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to DB");
  
  const rooms = await Room.find();
  if (rooms.length === 0) {
    console.log("No rooms found to attach bills to. Let's create a dummy user and room.");
    const user = await User.create({
      fullname: "Kyaw Kyaw",
      email: "kyaw@example.com",
      phone: "09123456789",
      password: "password123",
      role: "Citizen"
    });
    const room = await Room.create({
      room_name: "B05",
      floor: 1,
      room_type: "Standard",
      resident_id: user._id
    });
    rooms.push(room);
  }

  // Clear existing bills just in case
  await ServiceBill.deleteMany({});

  // create some dummy bills
  const dummyBills = [
    {
      room_id: rooms[0]._id,
      title: "May 2026 Maintenance Fee",
      type: "Maintenance",
      amount: 150000,
      status: "Paid",
      due_date: new Date("2026-05-15"),
      paid_at: new Date("2026-05-14"),
      payment_method: "WavePay",
      transaction_id: "WAVE-123456"
    },
    {
      room_id: rooms[0]._id,
      title: "June 2026 Electricity Bill",
      type: "Electricity",
      amount: 45000,
      status: "Pending",
      due_date: new Date("2026-06-15")
    },
    {
      room_id: rooms[Math.min(1, rooms.length - 1)]._id,
      title: "June 2026 Water Bill",
      type: "Water",
      amount: 12000,
      status: "Pending Verification",
      due_date: new Date("2026-06-10"),
      paid_at: new Date(),
      payment_method: "KBZPay",
      transaction_id: "KBZ-987654"
    }
  ];

  await ServiceBill.insertMany(dummyBills);
  console.log("Inserted dummy bills!");
  process.exit(0);
}

seed().catch(console.error);
