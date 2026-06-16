const { getToolSchemas } = require("../services/toolRegistry");

const getTools = async (req, res) => {
  return res.json({ success: true, tools: getToolSchemas() });
};

module.exports = { getTools };
