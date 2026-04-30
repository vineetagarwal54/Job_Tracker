// Runs in the target page's context via chrome.scripting.executeScript({ func }).
// Chrome serializes this function via Function.prototype.toString(), so it MUST
// be self-contained — no closure references, no imports, no external symbols.
// All helpers live inside.
export function detectFields() {
  const SKIP_INPUT_TYPES = new Set([
    "hidden", "submit", "button", "image", "reset", "file",
  ]);
  const NEARBY_TEXT_LIMIT = 200;
  const SELECT_OPTION_LIMIT = 12;
  const TEXT_INPUT_TYPES = new Set([
    "", "text", "email", "tel", "url", "search", "number",
    "date", "datetime-local", "month", "week", "time", "password",
  ]);

  const text = (s) => (s || "").replace(/\s+/g, " ").trim();

  // Select2 / Chosen hide the underlying native <select> with
  // display:none and put a visible custom widget alongside it. The form
  // submits the native select's value, so for filling we want the native
  // select in our field list — visible widget or not.
  const hasCustomSelectWrapper = (el) => {
    if (el.tagName !== "SELECT") return false;
    const cl = el.classList;
    if (cl && (cl.contains("select2-hidden-accessible") || cl.contains("chosen-select"))) return true;
    const next = el.nextElementSibling;
    if (next?.classList && (next.classList.contains("select2-container") || next.classList.contains("chosen-container"))) return true;
    const parent = el.parentElement;
    if (parent?.classList && (parent.classList.contains("select2-container") || parent.classList.contains("chosen-container"))) return true;
    if (parent && parent.querySelector(".select2-container, .chosen-container")) return true;
    return false;
  };

  const isVisible = (el) => {
    if (hasCustomSelectWrapper(el)) return true;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity || "1") === 0) return false;
    return true;
  };

  const stripFormControls = (node) => {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("input, textarea, select, button").forEach((n) => n.remove());
    return clone;
  };

  const labelFor = (el) => {
    // 1. <label for="id">
    if (el.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) {
          const t = text(stripFormControls(lbl).textContent);
          if (t) return t;
        }
      } catch { /* CSS.escape can throw on weird ids */ }
    }
    // 2. aria-labelledby
    const lblBy = el.getAttribute("aria-labelledby");
    if (lblBy) {
      const parts = lblBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      const t = text(parts);
      if (t) return t;
    }
    // 3. wrapping <label>
    const wrap = el.closest("label");
    if (wrap) {
      const t = text(stripFormControls(wrap).textContent);
      if (t) return t;
    }
    // 4. aria-label
    const aria = el.getAttribute("aria-label");
    if (aria) return text(aria);
    return "";
  };

  const nearbyText = (el) => {
    // Prefer fieldset legend if there is one
    const fs = el.closest("fieldset");
    if (fs) {
      const legend = fs.querySelector(":scope > legend");
      if (legend) {
        const t = text(legend.textContent);
        if (t) return t;
      }
    }
    // Otherwise, the parent's text minus any form controls. Capped to keep
    // the payload small and avoid pulling in long descriptions.
    const parent = el.parentElement;
    if (!parent) return "";
    const t = text(stripFormControls(parent).textContent);
    if (!t || t.length > NEARBY_TEXT_LIMIT) return "";
    return t;
  };

  const collectGroupOptions = (el, type) => {
    if (!el.name) return [];
    try {
      const peers = document.querySelectorAll(
        `input[type="${type}"][name="${CSS.escape(el.name)}"]`
      );
      const opts = [];
      peers.forEach((p) => {
        const lbl = labelFor(p) || p.value || "";
        const t = text(lbl);
        if (t) opts.push(t);
      });
      return opts;
    } catch {
      return [];
    }
  };

  // controlType normalizes the raw element into one of the buckets the side
  // panel and (eventually) the autofill engine care about. We look up to a
  // few ancestors for combobox/listbox roles to catch react-select-style
  // wrappers around hidden inputs.
  const detectControlType = (el, tag, rawType) => {
    if (tag === "select") return hasCustomSelectWrapper(el) ? "customSelect" : "select";
    if (rawType === "radio") return "radio";
    if (rawType === "checkbox") return "checkbox";
    if (tag === "textarea") return "text";
    const role = el.getAttribute("role");
    if (role === "combobox" || role === "listbox") return "customSelect";
    if (el.getAttribute("aria-haspopup") === "listbox") return "customSelect";
    let p = el.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const pr = p.getAttribute && p.getAttribute("role");
      if (pr === "combobox" || pr === "listbox") return "customSelect";
      if (p.getAttribute && p.getAttribute("aria-haspopup") === "listbox") return "customSelect";
    }
    if (TEXT_INPUT_TYPES.has(rawType)) return "text";
    return "unknown";
  };

  const seenRadioGroups = new Set();
  const seenCheckboxGroups = new Set();
  const fields = [];

  const elements = document.querySelectorAll("input, textarea, select");
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    const rawType = (el.type || "").toLowerCase();

    if (tag === "input" && SKIP_INPUT_TYPES.has(rawType)) continue;
    if (!isVisible(el)) continue;

    // Dedupe radio/checkbox groups by name — emit one entry per group
    if (tag === "input" && rawType === "radio" && el.name) {
      if (seenRadioGroups.has(el.name)) continue;
      seenRadioGroups.add(el.name);
    }
    if (tag === "input" && rawType === "checkbox" && el.name) {
      if (seenCheckboxGroups.has(el.name)) continue;
      seenCheckboxGroups.add(el.name);
    }

    const type = tag === "select" ? "select" : tag === "textarea" ? "textarea" : (rawType || "text");
    const controlType = detectControlType(el, tag, rawType);

    const field = {
      tag,
      type,
      controlType,
      name: el.name || "",
      id: el.id || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      autocomplete: el.getAttribute("autocomplete") || "",
      placeholder: el.getAttribute("placeholder") || "",
      required: !!(el.required || el.getAttribute("aria-required") === "true"),
      label: labelFor(el),
      nearby: nearbyText(el),
      options: [],
    };

    if (rawType === "radio" || rawType === "checkbox") {
      field.options = collectGroupOptions(el, rawType);
    } else if (tag === "select") {
      field.options = Array.from(el.options)
        .slice(0, SELECT_OPTION_LIMIT)
        .map((o) => text(o.text))
        .filter(Boolean);
    }

    fields.push(field);
  }

  return fields;
}
