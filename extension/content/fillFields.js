// Runs in the target page's context via chrome.scripting.executeScript({
// func, args: [plans] }). Like detectFields, this function MUST be
// self-contained — Chrome serializes it via Function.prototype.toString,
// so no closure references, no imports, no external symbols. All helpers
// live inside.
//
// Each frame the script runs in attempts to fulfill every plan item. Plans
// for elements not in the current frame come back with reason "not in this
// frame"; the side panel merges across frames and prefers the frame that
// found and acted on the element.
export function fillFields(plans) {
  const TEXT_TYPES = new Set([
    "", "text", "email", "tel", "url", "search", "number",
    "date", "datetime-local", "month", "week", "time", "password",
  ]);

  const norm = (s) =>
    (s == null ? "" : String(s))
      .toLowerCase()
      .replace(/[.,!?:;'"()[\]{}\\\/\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // For yes/no profile values we accept a range of phrasings on the option
  // side — Greenhouse and Workday occasionally write "I am authorized to
  // work" instead of "Yes". Returns "yes" / "no" / null.
  const yesNoReading = (text) => {
    const t = norm(text);
    if (!t) return null;
    if (t === "yes" || t === "y" || t === "true") return "yes";
    if (t === "no" || t === "n" || t === "false") return "no";
    // Negation must be checked first so "do not require sponsorship" → no.
    if (/\b(do not|don t|cannot|not authorized|not required|none)\b/.test(t)) return "no";
    if (/\b(authorized|i am authorized|i am eligible|require sponsorship|do require|require)\b/.test(t)) {
      // "require sponsorship" alone is a "yes" answer to a sponsorship
      // question; the negative case was handled above.
      return "yes";
    }
    return null;
  };

  // Picks the best option for a target value out of a list of
  // { text, value, el } entries. Exact match on text or value wins; then
  // yes/no synonym match if the target is "yes" / "no".
  const matchOption = (target, options) => {
    const t = norm(target);
    if (!t) return null;

    let m = options.find((o) => norm(o.text) === t || norm(o.value) === t);
    if (m) return m;

    if (t === "yes" || t === "no") {
      m = options.find((o) => yesNoReading(o.text) === t || yesNoReading(o.value) === t);
      if (m) return m;
    }

    // Loose contains-match as a last resort, but only if the target is
    // long enough that a substring is unlikely to be coincidental.
    if (t.length >= 3) {
      m = options.find((o) => norm(o.text).includes(t));
      if (m) return m;
    }
    return null;
  };

  // React/Vue/Angular controlled inputs override the value setter on the
  // element. Calling the *prototype's* native setter bypasses that and
  // makes the framework see the value as a real user edit when we
  // dispatch the input/change events that follow.
  const setNativeValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  };

  const fireInputChange = (el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const findElement = (plan) => {
    if (plan.id) {
      try {
        const el = document.getElementById(plan.id);
        if (el) return el;
      } catch { /* ignore */ }
    }
    if (plan.name) {
      try {
        const escaped = CSS.escape(plan.name);
        if (plan.tag === "select") {
          const el = document.querySelector(`select[name="${escaped}"]`);
          if (el) return el;
        } else if (plan.tag === "textarea") {
          const el = document.querySelector(`textarea[name="${escaped}"]`);
          if (el) return el;
        } else if (plan.controlType === "radio") {
          // Return any radio in the group; fillRadio re-queries the whole group.
          const el = document.querySelector(`input[type="radio"][name="${escaped}"]`);
          if (el) return el;
        } else {
          const el = document.querySelector(`input[name="${escaped}"]`);
          if (el) return el;
        }
      } catch { /* CSS.escape can throw on weird names */ }
    }
    return null;
  };

  const labelText = (el) => {
    if (el.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) return (lbl.textContent || "").trim();
      } catch { /* ignore */ }
    }
    const wrap = el.closest("label");
    if (wrap) return (wrap.textContent || "").trim();
    return "";
  };

  const isAlreadyFilled = (el, controlType) => {
    if (controlType === "radio") {
      try {
        const group = document.querySelectorAll(
          `input[type="radio"][name="${CSS.escape(el.name)}"]`
        );
        return Array.from(group).some((r) => r.checked);
      } catch { return false; }
    }
    if (controlType === "checkbox") return !!el.checked;
    if (controlType === "select") {
      // Treat the placeholder/empty-value option as not-filled.
      return !!(el.value && String(el.value).trim() !== "");
    }
    return !!(el.value && String(el.value).trim() !== "");
  };

  const fillTextInput = (el, value) => {
    el.focus();
    setNativeValue(el, value);
    fireInputChange(el);
    el.blur();
    return el.value;
  };

  const fillSelect = (el, value) => {
    const opts = Array.from(el.options).map((o) => ({
      text: o.text, value: o.value, el: o,
    }));
    const m = matchOption(value, opts);
    if (!m) return { final: el.value || "", error: `no matching option for "${value}"` };
    el.focus();
    setNativeValue(el, m.value);
    fireInputChange(el);
    el.blur();
    return { final: el.value || m.text };
  };

  const fillRadio = (plan, value) => {
    if (!plan.name) return { final: "", error: "radio group missing name attribute" };
    let peers;
    try {
      peers = Array.from(document.querySelectorAll(
        `input[type="radio"][name="${CSS.escape(plan.name)}"]`
      ));
    } catch {
      return { final: "", error: "could not query radio group" };
    }
    if (!peers.length) return { final: "", error: "radio group not in this frame" };
    const opts = peers.map((p) => ({
      text: labelText(p) || p.value, value: p.value, el: p,
    }));
    const m = matchOption(value, opts);
    if (!m) return { final: "", error: `no matching radio for "${value}"` };
    m.el.focus();
    m.el.click();
    fireInputChange(m.el);
    return { final: m.text || m.value };
  };

  const results = [];

  for (const plan of plans) {
    const result = {
      index: plan.index,
      label: plan.label || "",
      category: plan.category || "unknown",
      controlType: plan.controlType || "unknown",
      attempted: plan.plannedValue ?? "",
      final: "",
      success: false,
      skipped: false,
      reason: "",
    };

    if (!plan.plannedValue) {
      result.skipped = true;
      result.reason = "no profile value";
      results.push(result);
      continue;
    }

    let el;
    try {
      el = findElement(plan);
    } catch (err) {
      result.reason = err?.message || String(err);
      results.push(result);
      continue;
    }
    if (!el) {
      result.reason = "not in this frame";
      results.push(result);
      continue;
    }

    if (!plan.allowOverwrite && isAlreadyFilled(el, plan.controlType)) {
      result.skipped = true;
      result.reason = "already filled";
      // Surface what's currently in the field so the user can see it.
      result.final = plan.controlType === "radio"
        ? "(group already has a selection)"
        : (el.value || "");
      results.push(result);
      continue;
    }

    try {
      if (plan.controlType === "radio") {
        const r = fillRadio(plan, plan.plannedValue);
        result.final = r.final;
        result.success = !r.error;
        result.reason = r.error || "";
      } else if (plan.controlType === "select" && el.tagName === "SELECT") {
        const r = fillSelect(el, plan.plannedValue);
        result.final = r.final;
        result.success = !r.error && norm(r.final) !== "";
        result.reason = r.error || "";
      } else if (plan.controlType === "text") {
        const rawType = (el.type || "").toLowerCase();
        if (el.tagName !== "TEXTAREA" && el.tagName !== "INPUT") {
          result.reason = `unsupported element <${el.tagName.toLowerCase()}>`;
        } else if (el.tagName === "INPUT" && !TEXT_TYPES.has(rawType)) {
          result.reason = `unsupported input type "${rawType}"`;
        } else {
          const final = fillTextInput(el, plan.plannedValue);
          result.final = final;
          result.success = norm(final) === norm(plan.plannedValue);
          if (!result.success) result.reason = `value did not stick (got "${final}")`;
        }
      } else {
        result.skipped = true;
        result.reason = `${plan.controlType} not supported yet — fill manually`;
      }
    } catch (err) {
      result.reason = err?.message || String(err);
    }

    results.push(result);
  }

  return results;
}
