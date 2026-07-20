const fs = require("fs");
const path = require("path");

function parseEnv(text) {
  const values = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return parseEnv(fs.readFileSync(filePath, "utf8"));
}

function resolveAnthropicEnvironment({ env = process.env, isPackaged = false, executablePath = process.execPath, projectRoot } = {}) {
  const existing = String(env.ANTHROPIC_API_KEY || "").trim();
  if (existing) return { key: existing, configured: true, source: "environment" };
  const candidates = [];
  if (isPackaged) candidates.push(path.join(path.dirname(executablePath), ".env"));
  if (projectRoot) candidates.push(path.join(projectRoot, ".env"));
  for (const filePath of candidates) {
    const key = String(readEnvFile(filePath).ANTHROPIC_API_KEY || "").trim();
    if (key) return { key, configured: true, source: "environment" };
  }
  return { key: null, configured: false, source: "environment" };
}

module.exports = { parseEnv, readEnvFile, resolveAnthropicEnvironment };
