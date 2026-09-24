// Builds the sanitized application index that is mirrored to GitHub.
// Only metadata useful for de-duplicating job recommendations is included —
// never JDs, notes, salary, recruiter info, or anything personal.

const crypto = require("crypto");

// Allowlist of query params that identify a posting. Everything else (tracking,
// referral, session, or anything personal like ?email=) is dropped.
const IDENTITY_PARAM = /^(gh_jid|jk|vjk|currentjobid|jobid|job_id|job|jid|id|reqid|req_id|requisitionid|postingid|posting_id|pid)$/i;

function cleanUrl(link) {
  if (typeof link !== "string" || !link.trim()) return null;
  let u;
  try { u = new URL(link.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.hash = "";
  u.username = "";
  u.password = "";
  for (const key of [...u.searchParams.keys()]) {
    if (!IDENTITY_PARAM.test(key)) u.searchParams.delete(key);
  }
  return u;
}

// Returns { ats, id } for well-known ATS / job-board URL shapes, else null.
function extractRequisitionId(u) {
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);
  const q = u.searchParams;

  if (q.get("gh_jid")) return { ats: "greenhouse", id: q.get("gh_jid") };
  if (host.endsWith("greenhouse.io")) {
    const i = seg.indexOf("jobs");
    if (i !== -1 && /^\d+$/.test(seg[i + 1] || "")) return { ats: "greenhouse", id: seg[i + 1] };
  }
  if (host === "jobs.lever.co" && seg[1]) return { ats: "lever", id: seg[1].toLowerCase() };
  if (host === "jobs.ashbyhq.com" && seg[1]) return { ats: "ashby", id: seg[1].toLowerCase() };
  if (host.endsWith("myworkdayjobs.com") || host.endsWith("myworkday.com")) {
    const m = (seg[seg.length - 1] || "").match(/_([A-Za-z]*-?\d+(?:-\d+)?)$/);
    // Workday req IDs are only unique per tenant (the first host label).
    if (m) return { ats: "workday", id: `${host.split(".")[0]}:${m[1].toUpperCase()}` };
  }
  if (host.endsWith("linkedin.com")) {
    const i = seg.indexOf("view");
    const id = q.get("currentJobId") || (i !== -1 ? (seg[i + 1] || "").match(/(\d+)\/?$/)?.[1] : null);
    if (id && /^\d+$/.test(id)) return { ats: "linkedin", id };
  }
  if (host.endsWith("indeed.com") && q.get("jk")) return { ats: "indeed", id: q.get("jk") };
  if (host.endsWith("joinhandshake.com")) {
    const i = seg.indexOf("jobs");
    if (i !== -1 && /^\d+$/.test(seg[i + 1] || "")) return { ats: "handshake", id: seg[i + 1] };
  }
  if (host === "jobs.smartrecruiters.com" && seg[1]) {
    const m = seg[1].match(/^(\d+)/);
    if (m) return { ats: "smartrecruiters", id: m[1] };
  }
  return null;
}

// Canonical, comparison-friendly URL: lowercase host without "www.", no
// trailing slash, no fragment, only identity params, sorted.
function normalizeJobUrl(link) {
  const u = cleanUrl(link);
  if (!u) return "";
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const req = extractRequisitionId(u);
  if (req && req.ats === "linkedin") return `linkedin.com/jobs/view/${req.id}`;
  if (req && req.ats === "indeed") return `indeed.com/viewjob?jk=${req.id}`;
  const path = u.pathname.replace(/\/+$/, "");
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? "?" + new URLSearchParams(params).toString() : "";
  return host + path + query;
}

function basicNormalize(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompany(s) {
  return basicNormalize(s)
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|plc|gmbh|lp|llp)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeTitle(s) {
  return basicNormalize(s)
    .replace(/\bsr\b/g, "senior")
    .replace(/\bjr\b/g, "junior")
    .replace(/\bswe\b/g, "software engineer");
}

function normalizeLocation(s) {
  return basicNormalize(s);
}

// Preferred identity: requisition id > normalized URL > company+title+location.
function dedupeKey({ company, role, location, link }) {
  const u = cleanUrl(link);
  const req = extractRequisitionId(u);
  if (req) return `req:${req.ats}:${req.id}`;
  const url = normalizeJobUrl(link);
  if (url) return `url:${url}`;
  return `ctl:${normalizeCompany(company)}|${normalizeTitle(role)}|${normalizeLocation(location)}`;
}

// Primitives only: an object/array in an imported job can't be stringified
// into the output (e.g. a nested notes array ending up in "company").
function str(v) {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function sanitizeJob(job) {
  const company = str(job.company);
  const role = str(job.role);
  const location = str(job.location);
  const link = str(job.link);
  const u = cleanUrl(link);
  const req = extractRequisitionId(u);
  // Explicit allowlist, field by field: fixed key order, nothing else leaks through.
  return {
    id: str(job.id),
    company,
    role,
    jobUrl: u ? u.toString() : "",
    status: str(job.status),
    appliedAt: str(job.date), // JobTrack's "Date Applied" field (YYYY-MM-DD)
    location,
    resumeVariant: str(job.resume),
    source: str(job.source),
    normalizedUrl: normalizeJobUrl(link),
    requisitionId: req ? `${req.ats}:${req.id}` : "",
    dedupeKey: dedupeKey({ company, role, location, link }),
  };
}

// Sanitized applications, sorted by id so list reordering in the UI
// doesn't change the payload.
function buildApplications(jobs) {
  if (!Array.isArray(jobs)) return [];
  return jobs
    .filter((j) => j && typeof j === "object" && (j.company || j.role))
    .map(sanitizeJob)
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

function hashApplications(applications) {
  return crypto.createHash("sha256").update(JSON.stringify(applications)).digest("hex");
}

function buildIndexDocument(applications) {
  return { version: 1, updatedAt: new Date().toISOString(), applications };
}

module.exports = {
  buildApplications,
  buildIndexDocument,
  hashApplications,
  normalizeJobUrl,
  extractRequisitionId: (link) => extractRequisitionId(cleanUrl(link)),
  normalizeCompany,
  normalizeTitle,
  normalizeLocation,
  dedupeKey,
};
