require("dotenv").config();
const mongoose = require("mongoose");
const ServiceBill = require("./src/models/ServiceBill");
const Room = require("./src/models/Room");

async function fix() {
  await mongoose.connect(process.env.MONGO_URI);
  
  // Find rooms that have a resident
  const occupiedRooms = await Room.find({ resident_id: { $ne: null } });
  
  if (occupiedRooms.length > 0) {
    const room1 = occupiedRooms[0];
    const room2 = occupiedRooms.length > 1 ? occupiedRooms[1] : occupiedRooms[0];
    
    await ServiceBill.deleteMany({});
    
    const dummyBills = [
      {
        room_id: room1._id,
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
        room_id: room1._id,
        title: "June 2026 Electricity Bill",
        type: "Electricity",
        amount: 45000,
        status: "Pending",
        due_date: new Date("2026-06-15")
      },
      {
        room_id: room2._id,
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
    console.log("Fixed dummy bills with real residents!");
  }
  process.exit(0);
}
fix().catch(console.error);
