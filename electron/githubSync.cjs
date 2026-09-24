// Mirrors a sanitized application index (applications.json) to a private
// GitHub repo. Local data.json stays the source of truth; nothing here may
// throw into, block, or delay a local save.
//
// Secrets: the token is encrypted with Electron safeStorage into its own file
// and only ever held decrypted in this module's memory. It is never written to
// data.json, never returned over IPC, and never logged.

const { app, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const { buildApplications, buildIndexDocument, hashApplications } = require("./jobIndex.cjs");

const API = "https://api.github.com";
const FILE_PATH = "applications.json";
const COMMIT_MESSAGE = "Update JobTrack application index";
const DEBOUNCE_MS = 5000;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3;

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/;

let getJobsJson = () => null;
let notify = () => {};

let config = { owner: "", repo: "", branch: "main", enabled: false, lastSynced: null, lastSuccessAt: "" };
let token = null;
let tokenError = "";
let phase = "idle"; // idle | pending | syncing | synced | error
let lastError = "";
let timer = null;
let currentRun = null;
let rerun = false;
let verifiedTarget = null;

class SyncError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// ── Persistence ───────────────────────────────────────────────
const configPath = () => path.join(app.getPath("userData"), "github-sync.json");
const tokenPath = () => path.join(app.getPath("userData"), "github-token.bin");

function persistConfig() {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), { encoding: "utf-8", mode: 0o600 });
}

function encryptionUsable() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // On Linux without a keyring Electron falls back to a hardcoded key — not secure.
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text") return false;
  return true;
}

function loadToken() {
  token = null;
  tokenError = "";
  if (!fs.existsSync(tokenPath())) return;
  try {
    if (!encryptionUsable()) throw new Error();
    token = safeStorage.decryptString(fs.readFileSync(tokenPath()));
  } catch {
    token = null;
    tokenError = "Saved token could not be decrypted. Paste the token again to reconnect.";
  }
}

function init(opts) {
  getJobsJson = opts.getJobsJson;
  notify = opts.notify;
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    if (saved && typeof saved === "object") config = { ...config, ...saved };
  } catch {}
  loadToken();
  // Catches up on anything saved while offline or before the app last closed;
  // a no-op when the hash already matches.
  requestSync();
}

// ── Status ────────────────────────────────────────────────────
const targetKey = () => `${config.owner}/${config.repo}@${config.branch}`;
const isConfigured = () => Boolean(token && config.owner && config.repo && config.branch);
const isActive = () => isConfigured() && config.enabled;

function getStatus() {
  let state = phase;
  if (!isConfigured()) state = "not_configured";
  else if (!config.enabled) state = "disabled";
  return {
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    enabled: config.enabled,
    tokenConfigured: Boolean(token),
    state,
    lastSuccessAt: config.lastSuccessAt,
    lastError: tokenError || lastError,
  };
}

function setPhase(next) {
  phase = next;
  try { notify(getStatus()); } catch {}
}

// ── Config (IPC) ──────────────────────────────────────────────
function saveConfig(input) {
  if (!input || typeof input !== "object") throw new SyncError("Invalid settings.");
  const owner = String(input.owner || "").trim();
  const repo = String(input.repo || "").trim();
  const branch = String(input.branch || "").trim() || "main";
  const newToken = typeof input.token === "string" ? input.token.trim() : "";

  if (owner && !OWNER_RE.test(owner)) throw new SyncError("Invalid GitHub owner name.");
  if (repo && (!REPO_RE.test(repo) || /^\.+$/.test(repo))) throw new SyncError("Invalid repository name.");
  if (!BRANCH_RE.test(branch) || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
    throw new SyncError("Invalid branch name.");
  }
  if (newToken) {
    if (!TOKEN_RE.test(newToken)) throw new SyncError("That doesn't look like a GitHub token.");
    if (!encryptionUsable()) throw new SyncError("Secure storage is unavailable on this system; token not saved.");
    fs.writeFileSync(tokenPath(), safeStorage.encryptString(newToken), { mode: 0o600 });
    token = newToken;
    tokenError = "";
  }

  const prevTarget = targetKey();
  config.owner = owner;
  config.repo = repo;
  config.branch = branch;
  config.enabled = Boolean(input.enabled);
  if (targetKey() !== prevTarget || newToken) {
    config.lastSynced = null;
    verifiedTarget = null;
  }
  persistConfig();

  lastError = "";
  if (isActive()) requestSync();
  else { cancelScheduled(); phase = "idle"; }
  return getStatus();
}

function removeToken() {
  cancelScheduled();
  try { fs.rmSync(tokenPath(), { force: true }); } catch {}
  token = null;
  tokenError = "";
  lastError = "";
  verifiedTarget = null;
  config.lastSynced = null;
  persistConfig();
  setPhase("idle");
  return getStatus();
}

// ── GitHub client ─────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const repoPath = () => `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;

function httpError(status, data, headers) {
  const detail = data && typeof data.message === "string" ? data.message.slice(0, 160) : "";
  if (status === 401) return new SyncError("GitHub rejected the token (401). Replace the token.", status);
  if (status === 403 && headers.get("x-ratelimit-remaining") === "0") {
    return new SyncError("GitHub rate limit reached. Try again later.", status);
  }
  if (status === 403) return new SyncError("Token lacks permission (403). It needs Contents: Read and write on this repo.", status);
  if (status === 404) return new SyncError("Not found (404). Check owner, repo, branch, and the token's repository access.", status);
  if (status >= 300 && status < 400) return new SyncError("Repository was moved or renamed. Update the settings.", status);
  return new SyncError(`GitHub error ${status}${detail ? `: ${detail}` : ""}`, status);
}

async function gh(method, urlPath, body) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(API + urlPath, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "JobTrack",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt < MAX_ATTEMPTS) { await delay(1000 * attempt); continue; }
      throw new SyncError(e && e.name === "TimeoutError" ? "GitHub request timed out." : "Could not reach GitHub. Are you offline?");
    }
    if ((res.status >= 500 || res.status === 429) && attempt < MAX_ATTEMPTS) {
      await delay(1000 * attempt);
      continue;
    }
    let data = null;
    try {
      const text = await res.text();
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) throw httpError(res.status, data, res.headers);
    if (!data || typeof data !== "object") throw new SyncError("Unexpected response from GitHub.");
    return data;
  }
}

async function ensurePrivateRepo() {
  if (verifiedTarget === targetKey()) return;
  const data = await gh("GET", repoPath());
  if (typeof data.private !== "boolean") throw new SyncError("Unexpected response from GitHub.");
  if (!data.private) throw new SyncError("Repository is public. Sync only writes to a private repository.");
  verifiedTarget = targetKey();
}

// Returns { sha, hash } for the existing remote file, or null if it doesn't exist.
async function getRemoteFile() {
  let data;
  try {
    data = await gh("GET", `${repoPath()}/contents/${FILE_PATH}?ref=${encodeURIComponent(config.branch)}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
  if (Array.isArray(data) || data.type !== "file" || typeof data.sha !== "string") {
    throw new SyncError(`${FILE_PATH} in the repo is not a regular file.`);
  }
  let hash = null;
  try {
    const doc = JSON.parse(Buffer.from(data.content || "", "base64").toString("utf-8"));
    if (Array.isArray(doc.applications)) hash = hashApplications(doc.applications);
  } catch {}
  return { sha: data.sha, hash };
}

async function putRemoteFile(applications, sha) {
  const content = JSON.stringify(buildIndexDocument(applications), null, 2) + "\n";
  const data = await gh("PUT", `${repoPath()}/contents/${FILE_PATH}`, {
    message: COMMIT_MESSAGE,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch: config.branch,
    ...(sha ? { sha } : {}),
  });
  if (!data.content || typeof data.content.sha !== "string") throw new SyncError("Unexpected response from GitHub.");
}

async function syncOnce() {
  const raw = getJobsJson();
  if (raw == null) return; // nothing has ever been saved locally
  let jobs;
  try { jobs = JSON.parse(raw); } catch { throw new SyncError("Local job data could not be read."); }

  const applications = buildApplications(jobs);
  const hash = hashApplications(applications);
  const target = targetKey();
  if (config.lastSynced && config.lastSynced.target === target && config.lastSynced.hash === hash) return;

  await ensurePrivateRepo();
  // One conflict retry: another writer (or a retried request) moved the file's SHA.
  for (let attempt = 1; ; attempt++) {
    const remote = await getRemoteFile();
    if (remote && remote.hash === hash) break;
    try {
      await putRemoteFile(applications, remote && remote.sha);
      break;
    } catch (e) {
      if (attempt < 2 && (e.status === 409 || e.status === 422)) continue;
      throw e;
    }
  }
  config.lastSynced = { target, hash };
  config.lastSuccessAt = new Date().toISOString();
  persistConfig();
}

// ── Scheduling ────────────────────────────────────────────────
// Called after every successful local save of jobs. Debounced; the sync
// itself always reads the newest saved data, so bursts coalesce.
function requestSync() {
  if (!isActive()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; runSync(); }, DEBOUNCE_MS);
  if (phase !== "syncing") setPhase("pending");
}

function cancelScheduled() {
  clearTimeout(timer);
  timer = null;
}

function runSync() {
  if (currentRun) { rerun = true; return currentRun; }
  if (!isActive()) return Promise.resolve();
  currentRun = (async () => {
    setPhase("syncing");
    try {
      do {
        rerun = false;
        await syncOnce();
      } while (rerun && isActive());
      lastError = "";
      setPhase(timer ? "pending" : "synced");
    } catch (e) {
      lastError = e instanceof SyncError ? e.message : "Sync failed.";
      setPhase("error");
    } finally {
      currentRun = null;
    }
  })();
  return currentRun;
}

async function syncNow() {
  if (!isConfigured()) throw new SyncError("Add owner, repository, and token first.");
  if (!config.enabled) throw new SyncError("Enable sync first.");
  cancelScheduled();
  await runSync();
  return getStatus();
}

async function testConnection() {
  if (!isConfigured()) throw new SyncError("Add owner, repository, and token first.");
  verifiedTarget = null;
  await ensurePrivateRepo();
  await gh("GET", `${repoPath()}/branches/${encodeURIComponent(config.branch)}`);
  return "Connected. Private repository and branch are reachable.";
}

// IPC wrapper: renderer gets { ok, result } or { ok: false, error } with only
// our own curated messages, never raw exception text.
async function ipcResult(fn) {
  try {
    return { ok: true, result: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof SyncError ? e.message : "Unexpected error." };
  }
}

module.exports = { init, getStatus, saveConfig, removeToken, requestSync, syncNow, testConnection, ipcResult };
