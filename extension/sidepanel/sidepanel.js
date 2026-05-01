import { classifyField } from "../shared/fieldMatcher.js";
import { SAMPLE_PROFILE, YES_NO_CATEGORIES } from "../shared/sampleProfile.js";
import {
  TEST_NOTE_TYPES,
  TEST_NOTE_AREAS,
  saveTestNote,
  copyAllTestNotes,
} from "./testNotes.js";

// The service worker owns the scan and fill paths: it picks the active tab,
// checks the URL is scannable, and runs chrome.scripting.executeScript with
// detectFields and the split fill engine. The side panel is the brains —
// it classifies detected fields, builds a fill plan against the sample
// profile, and merges fill results back into the plan for verification.
//
// UI stays simple by default. Internal classification metadata (category id,
// confidence, profileKey, reasons) is hidden behind a debug toggle so the
// normal user view shows only label / planned value / status.

const root = document.getElementById("root");

const DEBUG_KEY = "jobtrack_debug_mode_v1";

const SHELL = `
  <header class="app-header">
    <div>
      <div class="brand">JOB<span>TRACK</span></div>
      <div class="tagline">Apply Helper</div>
    </div>
    <div class="header-actions">
      <label class="debug-toggle" title="Show internal field classification details">
        <input id="debug-toggle" type="checkbox" />
        <span>Debug</span>
      </label>
      <button id="rescan-btn" class="ghost" type="button">Rescan</button>
    </div>
  </header>
  <div id="content"></div>
  <div class="controls">
    <button id="fill-safe-btn" type="button">Fill all available fields</button>
    <button id="fill-selected-btn" class="ghost" type="button">Fill selected</button>
  </div>
  <div class="test-note-box">
  <div class="test-note-row">
    <select id="test-note-type"></select>
    <select id="test-note-area"></select>
  </div>

  <input
    id="test-note-field"
    type="text"
    placeholder="Optional field/question label"
  />

  <textarea
    id="test-note-text"
    rows="3"
    placeholder="Example: Ashby work authorization filled Yes but side panel showed failed."
  ></textarea>

  <div class="test-note-actions">
    <button id="save-test-note-btn" type="button" class="ghost">Save note</button>
    <button id="copy-test-notes-btn" type="button" class="ghost">Copy notes</button>
  </div>
</div>
`;

// Mutable per-scan state. The plan is rebuilt on every scan; results are
// keyed by plan index and overlay the plan in the rendered list.
const state = {
  tab: {},
  plan: [],            // FillPlanItem[]
  selected: new Set(), // plan indices the user ticked manually
  results: new Map(),  // index → FillResult
  debug: false,        // when true, render technical details
};

function optionsHtml(items) {
  return items.map((item) => `<option value="${item}">${item}</option>`).join("");
}

async function loadDebugMode() {
  try {
    const got = await chrome.storage?.local?.get?.(DEBUG_KEY);
    state.debug = !!got?.[DEBUG_KEY];
  } catch {
    state.debug = false;
  }
}

async function saveDebugMode(value) {
  state.debug = !!value;
  try {
    await chrome.storage?.local?.set?.({ [DEBUG_KEY]: !!value });
  } catch {
    // best-effort; toggle still works in-memory
  }
}

async function mount() {
  await loadDebugMode();

  root.innerHTML = SHELL;
  document.getElementById("rescan-btn").addEventListener("click", scan);
  document.getElementById("fill-safe-btn").addEventListener("click", fillAvailable);
  document.getElementById("fill-selected-btn").addEventListener("click", fillSelected);
  document.getElementById("content").addEventListener("change", onContentChange);

  const debugToggle = document.getElementById("debug-toggle");
  debugToggle.checked = state.debug;
  debugToggle.addEventListener("change", async (e) => {
    await saveDebugMode(e.target.checked);
    document.body.classList.toggle("debug-on", state.debug);
    render();
  });
  document.body.classList.toggle("debug-on", state.debug);

  document.getElementById("test-note-type").innerHTML = optionsHtml(TEST_NOTE_TYPES);
  document.getElementById("test-note-area").innerHTML = optionsHtml(TEST_NOTE_AREAS);

  document
    .getElementById("save-test-note-btn")
    .addEventListener("click", handleSaveTestNote);

  document
    .getElementById("copy-test-notes-btn")
    .addEventListener("click", handleCopyTestNotes);

  scan();
}

function onContentChange(e) {
  const cb = e.target.closest('input[type="checkbox"][data-plan-index]');
  if (!cb) return;
  const i = Number(cb.dataset.planIndex);
  if (cb.checked) state.selected.add(i);
  else state.selected.delete(i);
  render();
}

async function scan() {
  state.results.clear();
  state.selected.clear();
  setContent(`<div class="notice"><strong>Scanning…</strong>
    <div class="hint">Looking for form fields on the active tab.</div></div>`);

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "SCAN_ACTIVE_TAB" });
  } catch (err) {
    return renderError("Couldn't reach the scanner.", err?.message || String(err));
  }
  if (!response) return renderError("No response from the scanner.", "Try reloading the unpacked extension.");
  if (response.error) return renderError(response.error, response.hint || "");

  const fields = (response.fields || []).map((f) => ({ ...f, classification: classifyField(f) }));
  state.tab = response.tab || {};
  state.plan = fields.map((f, i) => buildPlanItem(f, i, SAMPLE_PROFILE));
  render();
}

const SUPPORTED_CONTROL_TYPES = new Set(["text", "select", "radio", "customSelect"]);

// Picks a profile value for the resolved category. Honors the category's
// profileKey override (e.g. educationStartYear → educationStartDate) so we
// don't have to duplicate values on the profile.
function resolveProfileValue(profile, profileKey, categoryId) {
  const keys = [profileKey, categoryId].filter(Boolean);

  for (const key of keys) {
    const value = profile[key];
    if (value != null && value !== "") return value;
  }

  return "";
}

// Pre-formats the planned value so what the user sees in the side panel
// matches what the fill engine will type. Light-touch: the fill engine still
// applies its own input-type-aware formatting at write time.
function formatPlannedValue(rawValue, expectedType) {
  const value = rawValue == null ? "" : String(rawValue).trim();
  if (!value) return value;

  if (expectedType === "year") {
    const m = value.match(/\b(19|20)\d{2}\b/);
    if (m) return m[0];
  }

  if (expectedType === "yesNo") {
    const v = value.toLowerCase();
    if (v === "yes" || v === "y" || v === "true") return "Yes";
    if (v === "no" || v === "n" || v === "false") return "No";
  }

  return value;
}

// Constructs one FillPlanItem from a detected+classified field. The item
// captures *what we'd write*, *how we'd locate it*, and the metadata the
// engine needs (expectedType, category) — but only the engine sees this.
// The UI surfaces just label/planned value/status by default.
function buildPlanItem(field, index, profile) {
  const c = field.classification;
  const supported = SUPPORTED_CONTROL_TYPES.has(field.controlType);

  const profileKey = c.profileKey || c.category;
  const expectedType = c.expectedType || "text";

  const rawValue = resolveProfileValue(profile, profileKey, c.category);
  let plannedValue = formatPlannedValue(rawValue, expectedType);

  // Yes/No categories: profile stores lowercase canonical "yes"/"no". Text
  // inputs get title case; selects/radios get the lowercase form and let
  // the fill engine's synonym matcher pick the matching option.
  if (YES_NO_CATEGORIES.has(c.category) && plannedValue) {
    if (field.controlType === "text") {
      plannedValue =
        plannedValue.toLowerCase() === "yes"
          ? "Yes"
          : plannedValue.toLowerCase() === "no"
            ? "No"
            : plannedValue;
    } else {
      plannedValue = plannedValue.toLowerCase();
    }
  }

  const knownCategory = Boolean(c.category && c.category !== "unknown");
  const fillable = knownCategory && !!plannedValue && supported;

  // reviewRequired/sensitive are warnings only — the user reviews before
  // submitting, and "Fill all available fields" still includes them.
  const safeAutoFill = fillable;

  return {
    index,
    // identity (used by the fill engine to re-find the element)
    id: field.id,
    name: field.name,
    tag: field.tag,
    type: field.type,
    controlType: field.controlType,
    label: field.label || field.ariaLabel || field.placeholder || "",
    // classification (kept around for plan + debug surfaces)
    category: c.category,
    profileKey,
    expectedType,
    safetyLevel: c.safetyLevel,
    bucket: c.bucket,
    confidence: c.confidence,
    reviewRequired: c.reviewRequired,
    sensitive: c.sensitive,
    reasons: c.reasons || c.signals || [],
    // detection context (debug only)
    section: field.section || "",
    parentBlockText: field.parentBlockText || "",
    // plan
    plannedValue,
    rawProfileValue: rawValue,
    fillable,
    safeAutoFill,
    options: field.options || [],
    required: !!field.required,
    placeholder: field.placeholder || "",
    autocomplete: field.autocomplete || "",
  };
}

function reasonNotFillable(item) {
  if (!item.category || item.category === "unknown") return "unknown field";
  if (!item.plannedValue) return "no profile value";
  if (!SUPPORTED_CONTROL_TYPES.has(item.controlType)) return `${item.controlType} not supported yet`;
  return "";
}

async function fillAvailable() {
  const picks = state.plan.filter((p) => p.fillable);
  await runFill(picks, false);
}

async function fillSelected() {
  const picks = state.plan.filter((p) => state.selected.has(p.index) && p.fillable);
  if (picks.length === 0) {
    flashControls("Select at least one fillable field.");
    return;
  }
  await runFill(picks, true);
}

async function runFill(picks, allowOverwrite) {
  if (picks.length === 0) {
    flashControls("Nothing to fill.");
    return;
  }
  const wirePlans = picks.map((p) => ({
    index: p.index,
    id: p.id,
    name: p.name,
    tag: p.tag,
    type: p.type,
    controlType: p.controlType,
    category: p.category,
    expectedType: p.expectedType,
    label: p.label,
    plannedValue: p.plannedValue,
    allowOverwrite,
  }));

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "FILL_FIELDS", plans: wirePlans });
  } catch (err) {
    flashControls(err?.message || String(err));
    return;
  }
  if (!response || response.error) {
    flashControls(response?.error || "Fill failed.");
    return;
  }
  for (const r of response.results || []) {
    state.results.set(r.index, r);
  }
  render();
}

function flashControls(msg) {
  const el = document.querySelector(".controls");
  if (!el) return;
  let banner = el.querySelector(".controls-msg");
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "controls-msg";
    el.prepend(banner);
  }
  banner.textContent = msg;
  setTimeout(() => banner && banner.remove(), 2400);
}

// ─ Status derivation ─────────────────────────────────────────────────

// Boils every plan item + its (optional) result down to a single user-facing
// status. This is what shows in the field card by default.
function statusOf(p) {
  const result = state.results.get(p.index);

  if (result) {
    if (result.success) return { id: "filled", label: "filled" };
    if (result.skipped) return { id: "skipped", label: result.reason === "already filled" ? "already filled" : "skipped" };
    return { id: "failed", label: "failed" };
  }

  if (!p.fillable) {
    if (p.category === "unknown") return { id: "unknown", label: "unknown" };
    if (!p.plannedValue) return { id: "missing", label: "no value" };
    if (!SUPPORTED_CONTROL_TYPES.has(p.controlType)) return { id: "unsupported", label: "unsupported" };
    return { id: "missing", label: "skipped" };
  }

  if (p.reviewRequired || p.sensitive) return { id: "review", label: "needs review" };

  return { id: "ready", label: "ready" };
}

// ─ Rendering ─────────────────────────────────────────────────────────

function render() {
  const fields = state.plan;
  const counts = countBuckets(fields);
  const fillCounts = countResults(state.results);

  const host = (() => {
    try { return new URL(state.tab.url).hostname; } catch { return state.tab.url || ""; }
  })();

  if (fields.length === 0) {
    setContent(`
      ${hostBlock(host)}
      <div class="notice">
        <strong>No form fields detected</strong>
        <div class="hint">Scroll to a part of the page with the application form, then click Rescan. Some forms render lazily.</div>
      </div>
    `);
    return;
  }

  const summary = renderSummary(counts, fillCounts);
  const list = fields.map(fieldCard).join("");
  setContent(`${summary}${hostBlock(host)}<div class="fields">${list}</div>`);
}

function countBuckets(fields) {
  const reviewRequired = fields.filter((f) => f.fillable && (f.reviewRequired || f.sensitive)).length;
  const ready = fields.filter((f) => f.fillable && !(f.reviewRequired || f.sensitive)).length;

  return {
    total: fields.length,
    ready,
    reviewRequired,
    available: fields.filter((f) => f.fillable).length,
    unknown: fields.filter((f) => f.category === "unknown").length,
  };
}

function countResults(results) {
  let filled = 0, failed = 0, skipped = 0;
  for (const r of results.values()) {
    if (r.success) filled++;
    else if (r.skipped) skipped++;
    else failed++;
  }
  return { filled, failed, skipped, attempted: results.size };
}

function renderSummary(counts, fillCounts) {
  const fillBlock = fillCounts.attempted > 0
    ? `
      <div class="fill-summary">
        <span class="fill-stat ok">${fillCounts.filled} filled</span>
        <span class="fill-stat warn">${fillCounts.skipped} skipped</span>
        <span class="fill-stat bad">${fillCounts.failed} failed</span>
        <span class="fill-stat info">${counts.reviewRequired} need review</span>
      </div>
    `
    : "";

  return `
    <div class="summary">
      <div class="summary-card">
        <div class="summary-num total">${counts.total}</div>
        <div class="summary-label">Total fields</div>
      </div>
      <div class="summary-card">
        <div class="summary-num high">${counts.available}</div>
        <div class="summary-label">Available to fill</div>
      </div>
      <div class="summary-card">
        <div class="summary-num review">${counts.reviewRequired}</div>
        <div class="summary-label">Need review</div>
      </div>
      <div class="summary-card">
        <div class="summary-num unknown">${counts.unknown}</div>
        <div class="summary-label">Unknown</div>
      </div>
    </div>
    ${fillBlock}
  `;
}

function hostBlock(host) {
  if (!host) return "";
  return `<div class="host"><strong>Page:</strong> ${escapeHtml(host)}</div>`;
}

function fieldCard(p) {
  const result = state.results.get(p.index);
  const labelText = p.label || `(no label) — ${p.name || p.id || p.type}`;
  const required = p.required ? `<span class="required-mark" title="Required">*</span>` : "";

  const status = statusOf(p);
  const statusTag = `<span class="tag status status-${status.id}">${escapeHtml(status.label)}</span>`;

  // Planned value preview — the only field-level signal we always show.
  const blocker = reasonNotFillable(p);
  const planned = p.plannedValue
    ? `<div class="planned"><strong>Plan:</strong> <span class="planned-value">${escapeHtml(p.plannedValue)}</span></div>`
    : `<div class="planned muted">${escapeHtml(blocker || "no value")}</div>`;

  // Failure reason gets a one-liner (the user needs to know why a fill
  // didn't work). Long debug text stays out of the default view.
  const resultBlock = result && !result.success && result.reason
    ? `<div class="result ${result.skipped ? "warn" : "bad"}"><strong>${result.skipped ? "Skipped" : "Failed"}:</strong> ${escapeHtml(result.reason)}</div>`
    : result && result.success && result.final
      ? `<div class="result ok"><strong>Filled:</strong> <span class="result-value">${escapeHtml(String(result.final))}</span></div>`
      : "";

  const selected = state.selected.has(p.index);
  const checkboxDisabled = !p.fillable;
  const checkbox = `
    <label class="select-cell" title="${checkboxDisabled ? escapeHtml(blocker) : "Include in Fill selected"}">
      <input type="checkbox"
        data-plan-index="${p.index}"
        ${selected ? "checked" : ""}
        ${checkboxDisabled ? "disabled" : ""} />
    </label>
  `;

  const debugBlock = state.debug ? renderDebugBlock(p) : "";

  const cardCls = `field status-${status.id}${result?.success ? " filled" : ""}${result && !result.success && !result.skipped ? " failed" : ""}`;

  return `
    <div class="${cardCls}">
      <div class="field-head">
        ${checkbox}
        <div class="field-label">${escapeHtml(labelText)}${required}</div>
        <div class="tags">${statusTag}</div>
      </div>
      ${planned}
      ${resultBlock}
      ${debugBlock}
    </div>
  `;
}

// Debug-only block. Hidden by default — only renders when the user has
// flipped the Debug toggle in the header.
function renderDebugBlock(p) {
  const rows = [];

  if (p.category) rows.push(["category", p.category]);
  if (p.profileKey && p.profileKey !== p.category) rows.push(["profileKey", p.profileKey]);
  if (p.expectedType) rows.push(["expectedType", p.expectedType]);
  if (typeof p.confidence === "number") rows.push(["confidence", String(p.confidence)]);
  if (p.bucket) rows.push(["bucket", p.bucket]);
  if (p.safetyLevel) rows.push(["safety", p.safetyLevel]);
  if (p.controlType) rows.push(["control", p.controlType]);
  if (p.reasons && p.reasons.length) rows.push(["reasons", p.reasons.join(" · ")]);
  if (p.section) rows.push(["section", p.section]);
  if (p.name) rows.push(["name", p.name]);
  if (p.id) rows.push(["id", p.id]);
  if (p.autocomplete) rows.push(["autocomplete", p.autocomplete]);
  if (p.placeholder && p.placeholder !== p.label) rows.push(["placeholder", p.placeholder]);

  const meta = rows.length
    ? `<dl class="meta">${rows.map(([k, v]) =>
        `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`
      ).join("")}</dl>`
    : "";

  const options = p.options && p.options.length
    ? `<div class="options"><strong>Options:</strong> ${escapeHtml(p.options.slice(0, 8).join(" · "))}${p.options.length > 8 ? " · …" : ""}</div>`
    : "";

  return `<div class="debug">${meta}${options}</div>`;
}

async function handleSaveTestNote() {
  const type = document.getElementById("test-note-type").value;
  const area = document.getElementById("test-note-area").value;
  const fieldLabel = document.getElementById("test-note-field").value;
  const noteInput = document.getElementById("test-note-text");
  const note = noteInput.value;

  try {
    await saveTestNote({
      type,
      area,
      fieldLabel,
      note,
      tab: state.tab,
    });

    noteInput.value = "";
    flashControls("Test note saved.");
  } catch (err) {
    flashControls(err?.message || String(err));
  }
}

async function handleCopyTestNotes() {
  try {
    const count = await copyAllTestNotes();
    flashControls(`Copied ${count} saved notes.`);
  } catch (err) {
    flashControls(err?.message || String(err));
  }
}

function renderError(title, hint) {
  setContent(`<div class="notice error"><strong>${escapeHtml(title)}</strong>
    <div class="hint">${escapeHtml(hint)}</div></div>`);
}

function setContent(html) {
  document.getElementById("content").innerHTML = html;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

mount();
