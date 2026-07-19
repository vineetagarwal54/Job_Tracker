const fs = require("fs"); const path = require("path");

function createKeyStore({ safeStorage, userDataPath }) {
  const filePath = path.join(userDataPath, "anthropic-key.json");
  const readRecord = () => fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null;
  const status = () => { const record = readRecord(); return { configured: Boolean(record?.value), encrypted: record?.mode === "safeStorage", warning: record?.mode === "plaintext" ? "API key is stored without OS encryption." : null }; };
  const readKey = () => { const record = readRecord(); if (!record?.value) return null; return record.mode === "safeStorage" ? safeStorage.decryptString(Buffer.from(record.value, "base64")) : Buffer.from(record.value, "base64").toString("utf8"); };
  const saveKey = (key, { acknowledgePlaintextFallback = false } = {}) => {
    const value = String(key || "").trim(); if (!value) throw new Error("Enter an Anthropic API key.");
    const encrypted = safeStorage.isEncryptionAvailable();
    if (!encrypted && !acknowledgePlaintextFallback) return { ok: false, requiresAcknowledgement: true, warning: "OS encryption is unavailable. Explicit acknowledgement is required before plaintext fallback." };
    fs.mkdirSync(userDataPath, { recursive: true });
    const record = encrypted ? { version: 1, mode: "safeStorage", value: safeStorage.encryptString(value).toString("base64") } : { version: 1, mode: "plaintext", value: Buffer.from(value).toString("base64") };
    const tmp = `${filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(record), { encoding: "utf8", mode: 0o600 }); fs.renameSync(tmp, filePath);
    return { ok: true, ...status() };
  };
  const deleteKey = () => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); return { ok: true, configured: false, encrypted: false, warning: null }; };
  return { status, readKey, saveKey, deleteKey, filePath };
}
module.exports = { createKeyStore };
