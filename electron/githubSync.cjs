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

let getAppDataJson = () => null;
let notify = () => {};

// workspaceIds: null = every workspace (default for configs saved before this
// option existed); an array = only jobs in those workspaces are synced.
let config = { owner: "", repo: "", branch: "main", enabled: false, workspaceIds: null, lastSynced: null, lastSuccessAt: "" };
let token = null;
let tokenError = "";
let phase = "idle"; // idle | pending | syncing | synced | error
let lastError = "";
let timer = null;
let currentRun = null;
let rerun = false;

class SyncError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail || "";
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
  getAppDataJson = opts.getAppDataJson;
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
// Taken once per operation so a settings change mid-sync can't redirect
// requests (or the token) to a repository that wasn't checked as private.
const snapshotTarget = () => ({ owner: config.owner, repo: config.repo, branch: config.branch, token, key: targetKey() });
const isConfigured = () => Boolean(token && config.owner && config.repo && config.branch);
const isActive = () => isConfigured() && config.enabled;

function getStatus() {
  let state = phase;
  if (!isConfigured()) state = "not_configured";
  else if (!config.enabled) state = "disabled";
  else if (state === "synced" && !config.lastSuccessAt) state = "idle"; // nothing uploaded yet (no saved jobs)
  return {
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    enabled: config.enabled,
    workspaceIds: config.workspaceIds,
    tokenConfigured: Boolean(token),
    state,
    lastSuccessAt: config.lastSuccessAt,
    syncedCount: config.lastSynced && typeof config.lastSynced.count === "number" ? config.lastSynced.count : null,
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
  let workspaceIds = config.workspaceIds;
  if (input.workspaceIds !== undefined) {
    const ids = input.workspaceIds;
    const validId = (id) => (typeof id === "number" && Number.isFinite(id)) || (typeof id === "string" && id.length <= 64);
    if (!Array.isArray(ids) || ids.length > 200 || !ids.every(validId)) throw new SyncError("Invalid workspace selection.");
    if (ids.length === 0) throw new SyncError("Select at least one workspace to sync.");
    workspaceIds = [...new Set(ids)];
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
  config.workspaceIds = workspaceIds;
  if (targetKey() !== prevTarget || newToken) config.lastSynced = null;
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
  config.lastSynced = null;
  persistConfig();
  setPhase("idle");
  return getStatus();
}

// ── GitHub client ─────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const repoPath = (t) => `/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}`;

function httpError(status, data, headers) {
  const detail = data && typeof data.message === "string" ? data.message.slice(0, 160) : "";
  const err = (msg) => new SyncError(msg, status, detail);
  if (status === 401) return err("GitHub rejected the token (401). Replace the token.");
  if (status === 403 && (headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(detail))) {
    return err("GitHub rate limit reached. Try again later.");
  }
  if (status === 403) return err("Token lacks permission (403). It needs Contents: Read and write on this repo.");
  if (status === 404) return err("Not found (404). Check owner, repo, branch, and the token's repository access.");
  if (status >= 300 && status < 400) return err("Repository was moved or renamed. Update the settings.");
  return err(`GitHub error ${status}${detail ? `: ${detail}` : ""}`);
}

// Retries only network errors/timeouts, 5xx and 429 — never 4xx auth/permission errors.
async function gh(t, method, urlPath, body) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(API + urlPath, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${t.token}`,
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

// Checked on every sync (not cached) so a repo later made public is refused.
async function ensurePrivateRepo(t) {
  const data = await gh(t, "GET", repoPath(t));
  if (typeof data.private !== "boolean") throw new SyncError("Unexpected response from GitHub.");
  if (!data.private) throw new SyncError("Repository is public. Sync only writes to a private repository.");
}

// Returns { sha, hash } for the existing remote file, or null if it doesn't
// exist. The repo was just verified reachable, so a 404 here means the file
// (or, on first use, the branch) is missing; PUT reports a missing branch.
async function getRemoteFile(t) {
  let data;
  try {
    data = await gh(t, "GET", `${repoPath(t)}/contents/${FILE_PATH}?ref=${encodeURIComponent(t.branch)}`);
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

async function putRemoteFile(t, applications, sha) {
  const content = JSON.stringify(buildIndexDocument(applications), null, 2) + "\n";
  const data = await gh(t, "PUT", `${repoPath(t)}/contents/${FILE_PATH}`, {
    message: COMMIT_MESSAGE,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch: t.branch,
    ...(sha ? { sha } : {}),
  });
  if (!data.content || typeof data.content.sha !== "string") throw new SyncError("Unexpected response from GitHub.");
}

// SHA conflict: someone else changed the file, or a retried PUT already landed
// (GitHub answers 409, or 422 "sha wasn't supplied"/"does not match").
const isShaConflict = (e) => e.status === 409 || (e.status === 422 && /\bsha\b/i.test(e.detail));

async function syncOnce() {
  let raw;
  try { raw = getAppDataJson(); } catch { throw new SyncError("Local job data could not be read."); }
  if (raw == null) return; // nothing has ever been saved locally
  // app_data_v3 = { workspaces, activeWorkspaceId, jobs } — jobs spans every
  // workspace; keep only the selected ones. Workspace names/ids are not synced.
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!data || !Array.isArray(data.jobs)) throw new SyncError("Local job data could not be read.");
  const selected = Array.isArray(config.workspaceIds) ? new Set(config.workspaceIds.map(String)) : null;
  const jobs = selected ? data.jobs.filter((j) => j && selected.has(String(j.workspaceId))) : data.jobs;
  // Never replace the remote index with an empty one because of a selection
  // that matches nothing — that would silently wipe the dedupe history.
  if (selected && jobs.length === 0) {
    throw new SyncError(`The selected workspace(s) contain none of your ${data.jobs.length} jobs, so nothing was uploaded. Check "Workspaces to sync".`);
  }

  const applications = buildApplications(jobs);
  const hash = hashApplications(applications);
  const t = snapshotTarget();
  if (config.lastSynced && config.lastSynced.target === t.key && config.lastSynced.hash === hash) return;

  await ensurePrivateRepo(t);
  // One conflict retry: re-read the SHA; skip the write if content already matches.
  for (let attempt = 1; ; attempt++) {
    const remote = await getRemoteFile(t);
    if (remote && remote.hash === hash) break;
    try {
      await putRemoteFile(t, applications, remote && remote.sha);
      break;
    } catch (e) {
      if (attempt < 2 && isShaConflict(e)) continue;
      throw e;
    }
  }
  config.lastSynced = { target: t.key, hash, count: applications.length };
  config.lastSuccessAt = new Date().toISOString();
  persistConfig();
}

// ── Scheduling ────────────────────────────────────────────────
// Called after every successful local save of app data. Debounced; the sync
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
  const t = snapshotTarget();
  await ensurePrivateRepo(t);
  await gh(t, "GET", `${repoPath(t)}/branches/${t.branch.split("/").map(encodeURIComponent).join("/")}`);
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
