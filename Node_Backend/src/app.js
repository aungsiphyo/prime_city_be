const express = require("express");
const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Smart City Backend API is Running from app.js!",
    status: "Healthy",
  });
});

module.exports = app;
