// Runs in the target page's context via chrome.scripting.executeScript({ func }).
// Chrome serializes this function via Function.prototype.toString(), so it MUST
// be self-contained — no closure references, no imports, no external symbols.
// All helpers live inside.
export function detectFields() {
  const SKIP_INPUT_TYPES = new Set([
    "hidden", "submit", "button", "image", "reset", "file",
  ]);
  const NEARBY_TEXT_LIMIT = 200;
  const PARENT_BLOCK_TEXT_LIMIT = 600;
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

  // Walks up looking for the nearest section heading. Section headings tell
  // us things like "Education" or "Work Experience" so a vague label like
  // "Year" inside that block can resolve to educationStartYear etc.
  //
  // We check, in order:
  //   1. Fieldset legend on the way up.
  //   2. Any ancestor that has a heading-like first child.
  //   3. The nearest preceding sibling that is itself a heading or contains one.
  //   4. Ancestor classes / data attributes that name a section.
  const SECTION_KEYWORDS = [
    "education", "school", "degree", "academic",
    "experience", "employment", "work history", "previous role",
    "personal", "contact", "profile",
    "voluntary", "self identification", "demographic",
    "eligibility", "authorization",
  ];

  const sectionFromAncestorClasses = (el) => {
    let node = el.parentElement;
    for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
      const blob = `${node.className || ""} ${node.id || ""} ${node.getAttribute?.("data-section") || ""}`.toLowerCase();
      for (const keyword of SECTION_KEYWORDS) {
        if (blob.includes(keyword.replace(/\s+/g, "-")) || blob.includes(keyword.replace(/\s+/g, "_")) || blob.includes(keyword)) {
          return keyword;
        }
      }
    }
    return "";
  };

  const sectionFromHeadings = (el) => {
    // Find the nearest preceding heading by walking up-and-back.
    let node = el;
    let depth = 0;

    while (node && depth < 8) {
      // Look at previous siblings of this node first.
      let sib = node.previousElementSibling;
      while (sib) {
        if (/^h[1-6]$/i.test(sib.tagName) || sib.getAttribute?.("role") === "heading") {
          const t = text(sib.textContent);
          if (t) return t.slice(0, 120);
        }
        const inner = sib.querySelector?.("h1,h2,h3,h4,h5,h6,[role='heading']");
        if (inner) {
          const t = text(inner.textContent);
          if (t) return t.slice(0, 120);
        }
        sib = sib.previousElementSibling;
      }

      const parent = node.parentElement;
      if (parent) {
        // Heading as the parent's first child (common pattern).
        const firstHeading = parent.querySelector?.(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > [role='heading']");
        if (firstHeading) {
          const t = text(firstHeading.textContent);
          if (t) return t.slice(0, 120);
        }
      }

      node = parent;
      depth += 1;
    }

    return "";
  };

  const sectionTextFor = (el) => {
    const fs = el.closest("fieldset");
    if (fs) {
      const legend = fs.querySelector(":scope > legend");
      if (legend) {
        const t = text(legend.textContent);
        if (t) return t.slice(0, 120);
      }
    }

    const heading = sectionFromHeadings(el);
    if (heading) return heading;

    return sectionFromAncestorClasses(el);
  };

  // Captures a slightly wider chunk of context than nearbyText — useful for
  // catching headings/labels that sit a few elements away from the input but
  // still inside the same logical block.
  const parentBlockTextFor = (el) => {
    let node = el.parentElement;
    for (let depth = 0; depth < 4 && node; depth++, node = node.parentElement) {
      const cls = `${node.className || ""}`.toLowerCase();
      // Stop at obvious form/group boundaries.
      if (/section|fieldset|group|education|experience|work|employment|school|profile|application/.test(cls)) {
        const t = text(stripFormControls(node).textContent);
        if (t) return t.slice(0, PARENT_BLOCK_TEXT_LIMIT);
      }
    }

    // Fallback: a couple of levels up regardless.
    let parent = el.parentElement?.parentElement || el.parentElement;
    if (!parent) return "";
    const t = text(stripFormControls(parent).textContent);
    return t ? t.slice(0, PARENT_BLOCK_TEXT_LIMIT) : "";
  };

  const groupPeers = (el, type) => {
    if (!el.name) return [];

    try {
      return Array.from(
        document.querySelectorAll(`input[type="${type}"][name="${CSS.escape(el.name)}"]`)
      );
    } catch {
      return [];
    }
  };

  const getChoiceGroupRoot = (el, type) => {
    const peers = groupPeers(el, type);

    if (peers.length < 2) return null;

    let node = el.parentElement;

    for (let depth = 0; depth < 8 && node; depth += 1) {
      if (peers.every((peer) => node.contains(peer))) return node;
      node = node.parentElement;
    }

    return null;
  };

  const cleanChoiceQuestionText = (value) => {
    return text(
      value
        .replace(/\bYes\b/gi, " ")
        .replace(/\bNo\b/gi, " ")
        .replace(/\bPrefer not to say\b/gi, " ")
        .replace(/\bI do not wish to answer\b/gi, " ")
        .replace(/\bI don't wish to answer\b/gi, " ")
        .replace(/\s+/g, " ")
    );
  };

  const choiceGroupText = (el, type) => {
    const fieldset = el.closest("fieldset");

    if (fieldset) {
      const legend = fieldset.querySelector(":scope > legend");
      const legendText = text(legend?.textContent || "");

      if (legendText) return legendText;
    }

    const root = getChoiceGroupRoot(el, type);

    if (!root) return "";

    const labelledBy = root.getAttribute?.("aria-labelledby");

    if (labelledBy) {
      const labelledText = text(
        labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent || "")
          .join(" ")
      );

      if (labelledText) return labelledText;
    }

    const cleanedText = cleanChoiceQuestionText(stripFormControls(root).textContent || "");

    return cleanedText.length > 8 ? cleanedText : "";
  };

  const shouldKeepHiddenChoiceInput = (el, type) => {
    if (type !== "radio" && type !== "checkbox") return false;

    const root = getChoiceGroupRoot(el, type);

    return !!root && isVisible(root) && !!choiceGroupText(el, type);
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

    const isChoiceInput = tag === "input" && (rawType === "radio" || rawType === "checkbox");

    if (!isVisible(el) && !shouldKeepHiddenChoiceInput(el, rawType)) continue;

    const groupedChoiceLabel = isChoiceInput ? choiceGroupText(el, rawType) : "";

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
      label: groupedChoiceLabel || labelFor(el),
      nearby: groupedChoiceLabel || nearbyText(el),
      // New: section/parent-block context for vague labels.
      section: sectionTextFor(el),
      parentBlockText: parentBlockTextFor(el),
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
