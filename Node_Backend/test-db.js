const mongoose = require("mongoose");
require("dotenv").config();

const uri = process.env.MONGO_URI;

console.log("⏳ MongoDB ကို ချိတ်ဆက်ဖို့ ကြိုးစားနေပါတယ်...");

mongoose
  .connect(uri)
  .then(() => {
    console.log("✅ ဟေး... အောင်မြင်သွားပြီ!");
    console.log("🚀 VS Code ကနေ MongoDB Atlas ကို ချိတ်မိသွားပါပြီ။");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ ချိတ်ဆက်မှု မအောင်မြင်ပါ -");
    console.error(err);
    process.exit(1);
  });
