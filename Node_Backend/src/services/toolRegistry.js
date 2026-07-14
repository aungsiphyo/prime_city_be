const fs = require("fs");
const path = require("path");

const toolsDir = path.join(__dirname, "../mcp/tools");

function getToolSchemas() {
  if (!fs.existsSync(toolsDir)) return [];

  const seenNames = new Set();
  const files = fs.readdirSync(toolsDir).filter((f) => f.endsWith(".json"));

  return files
    .map((file) => {
      try {
        return require(path.join(toolsDir, file));
      } catch (err) {
        console.error("Failed to load tool schema", file, err.message);
        return null;
      }
    })
    .filter((tool) => {
      if (!tool?.name) return false;
      if (seenNames.has(tool.name)) return false;

      seenNames.add(tool.name);
      return true;
    });
}

module.exports = {
  getToolSchemas,
};
