const express = require("express");
const router = express.Router();

const { getTools } = require("../controllers/mcp.controller");

router.get("/tools", getTools);

module.exports = router;
