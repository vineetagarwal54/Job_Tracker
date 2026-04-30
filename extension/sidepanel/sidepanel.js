import { classifyField } from "../shared/fieldMatcher.js";
import { SAMPLE_PROFILE, YES_NO_CATEGORIES } from "../shared/sampleProfile.js";

// The service worker owns the scan and fill paths: it picks the active tab,
// checks the URL is scannable, and runs chrome.scripting.executeScript with
// detectFields / fillFields. The side panel is the brains — it classifies
// detected fields, builds a fill plan against the sample profile, and
// merges fill results back into the plan for verification.

const root = document.getElementById("root");

const SHELL = `
  <header class="app-header">
    <div>
      <div class="brand">JOB<span>TRACK</span></div>
      <div class="tagline">Apply Helper</div>
    </div>
    <button id="rescan-btn" class="ghost" type="button">Rescan</button>
  </header>
  <div id="content"></div>
  <div class="controls">
    <button id="fill-safe-btn" type="button">Fill safe fields</button>
    <button id="fill-selected-btn" class="ghost" type="button">Fill selected</button>
  </div>
`;

// Mutable per-scan state. The plan is rebuilt on every scan; results are
// keyed by plan index and overlay the plan in the rendered list.
const state = {
  tab: {},
  plan: [],            // FillPlanItem[]
  selected: new Set(),  // plan indices the user ticked manually
  results: new Map(),  // index → FillResult
};

function mount() {
  root.innerHTML = SHELL;
  document.getElementById("rescan-btn").addEventListener("click", scan);
  document.getElementById("fill-safe-btn").addEventListener("click", fillSafe);
  document.getElementById("fill-selected-btn").addEventListener("click", fillSelected);
  document.getElementById("content").addEventListener("change", onContentChange);
  scan();
}

function onContentChange(e) {
  const cb = e.target.closest('input[type="checkbox"][data-plan-index]');
  if (!cb) return;
  const i = Number(cb.dataset.planIndex);
  if (cb.checked) state.selected.add(i);
  else state.selected.delete(i);
  // Cheap per-row update — re-render full list to keep markup simple.
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

// Constructs one FillPlanItem from a detected+classified field. The item
// captures *what we'd write* and *how we'd locate it* — the fill engine in
// the page reads this verbatim.
function buildPlanItem(field, index, profile) {
  const c = field.classification;
  const supported = SUPPORTED_CONTROL_TYPES.has(field.controlType);
  let plannedValue = profile[c.category];
  if (plannedValue == null) plannedValue = "";

  // Yes/No categories: profile stores lowercase canonical "yes"/"no". Text
  // inputs get title case; selects/radios get the lowercase form and let
  // the fill engine's synonym matcher pick the matching option.
  if (YES_NO_CATEGORIES.has(c.category) && plannedValue) {
    if (field.controlType === "text") {
      plannedValue = plannedValue.toLowerCase() === "yes" ? "Yes" : plannedValue.toLowerCase() === "no" ? "No" : plannedValue;
    } else {
      plannedValue = plannedValue.toLowerCase();
    }
  }

  const fillable = !!plannedValue && supported;
  const safeAutoFill = fillable && c.bucket === "high" && !c.reviewRequired && !c.sensitive;

  return {
    index,
    // identity (used by the fill engine to re-find the element)
    id: field.id,
    name: field.name,
    tag: field.tag,
    type: field.type,
    controlType: field.controlType,
    label: field.label || field.ariaLabel || field.placeholder || "",
    // classification
    category: c.category,
    bucket: c.bucket,
    confidence: c.confidence,
    reviewRequired: c.reviewRequired,
    sensitive: c.sensitive,
    // plan
    plannedValue,
    fillable,
    safeAutoFill,
    options: field.options || [],
    required: !!field.required,
    placeholder: field.placeholder || "",
    autocomplete: field.autocomplete || "",
  };
}

const SUPPORTED_CONTROL_TYPES = new Set(["text", "select", "radio"]);

function reasonNotFillable(item) {
  if (!SUPPORTED_CONTROL_TYPES.has(item.controlType)) return `${item.controlType} not supported yet`;
  if (!item.plannedValue) return "no profile value";
  return "";
}

async function fillSafe() {
  const picks = state.plan.filter((p) => p.safeAutoFill);
  await runFill(picks, false);
}

async function fillSelected() {
  const picks = state.plan.filter((p) => state.selected.has(p.index) && p.fillable);
  if (picks.length === 0) {
    flashControls("Select at least one fillable field.");
    return;
  }
  // User explicitly asked → allow overwrite of any already-filled values.
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
  return {
    total: fields.length,
    high: fields.filter((f) => f.bucket === "high").length,
    review: fields.filter((f) => f.bucket === "review").length,
    unknown: fields.filter((f) => f.bucket === "unknown").length,
    safe: fields.filter((f) => f.safeAutoFill).length,
    reviewRequired: fields.filter((f) => f.reviewRequired).length,
    sensitive: fields.filter((f) => f.sensitive).length,
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
        <div class="summary-num high">${counts.safe}</div>
        <div class="summary-label">Safe to autofill</div>
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

  // Tags
  const tags = [];
  tags.push(p.category === "unknown"
    ? `<span class="tag cat">unknown</span>`
    : `<span class="tag cat-known">${escapeHtml(p.category)}</span>`);
  tags.push(`<span class="tag conf-${p.bucket}">${p.bucket}</span>`);
  tags.push(`<span class="tag control">${escapeHtml(p.controlType || "unknown")}</span>`);
  if (p.safeAutoFill) tags.push(`<span class="tag safe">safe</span>`);
  if (p.reviewRequired) tags.push(`<span class="tag review-flag">review required</span>`);
  if (p.sensitive) tags.push(`<span class="tag sensitive">sensitive</span>`);
  if (result) tags.push(renderResultTag(result));

  // Planned value preview
  const blocker = reasonNotFillable(p);
  const planned = p.plannedValue
    ? `<div class="planned"><strong>Plan:</strong> <span class="planned-value">${escapeHtml(p.plannedValue)}</span></div>`
    : `<div class="planned muted">${escapeHtml(blocker)}</div>`;

  // Fill result detail
  const resultBlock = result ? renderResultBlock(result) : "";

  // Selection checkbox: only show when fillable. Sensitive fields can be
  // selected but never auto-filled.
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

  const meta = metaRows(p);
  const options = p.options && p.options.length
    ? `<div class="options"><strong>Options:</strong> ${escapeHtml(p.options.slice(0, 8).join(" · "))}${p.options.length > 8 ? " · …" : ""}</div>`
    : "";

  return `
    <div class="field ${p.bucket}${result?.success ? " filled" : ""}${result && !result.success && !result.skipped ? " failed" : ""}">
      <div class="field-head">
        ${checkbox}
        <div class="field-label">${escapeHtml(labelText)}${required}</div>
        <div class="tags">${tags.join("")}</div>
      </div>
      ${planned}
      ${resultBlock}
      ${meta}
      ${options}
    </div>
  `;
}

function renderResultTag(result) {
  if (result.success) return `<span class="tag result-ok">filled</span>`;
  if (result.skipped) return `<span class="tag result-skip">skipped</span>`;
  return `<span class="tag result-fail">failed</span>`;
}

function renderResultBlock(result) {
  const reason = result.reason ? ` — ${escapeHtml(result.reason)}` : "";
  const finalValue = result.final ? ` → <span class="result-value">${escapeHtml(String(result.final))}</span>` : "";
  if (result.success) {
    return `<div class="result ok"><strong>Filled:</strong>${finalValue}</div>`;
  }
  if (result.skipped) {
    return `<div class="result warn"><strong>Skipped${reason}</strong>${finalValue}</div>`;
  }
  return `<div class="result bad"><strong>Failed${reason}</strong>${finalValue}</div>`;
}

function metaRows(p) {
  const rows = [];
  if (p.name) rows.push(["name", p.name]);
  if (p.id) rows.push(["id", p.id]);
  if (p.autocomplete) rows.push(["autocomplete", p.autocomplete]);
  if (p.placeholder && p.placeholder !== p.label) rows.push(["placeholder", p.placeholder]);
  if (!rows.length) return "";
  return `<dl class="meta">${rows.map(([k, v]) =>
    `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`
  ).join("")}</dl>`;
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
