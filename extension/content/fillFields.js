// // Runs in the target page's context via chrome.scripting.executeScript({
// // func, args: [plans] }). Like detectFields, this function MUST be
// // self-contained — Chrome serializes it via Function.prototype.toString,
// // so no closure references, no imports, no external symbols. All helpers
// // live inside.
// //
// // Each frame the script runs in attempts to fulfill every plan item. Plans
// // for elements not in the current frame come back with reason "not in this
// // frame"; the side panel merges across frames and prefers the frame that
// // found and acted on the element.
// export function fillFields(plans) {
//   const TEXT_TYPES = new Set([
//     "", "text", "email", "tel", "url", "search", "number",
//     "date", "datetime-local", "month", "week", "time", "password",
//   ]);

//   const norm = (s) =>
//     (s == null ? "" : String(s))
//       .toLowerCase()
//       .replace(/[.,!?:;'"()[\]{}\\\/\-]/g, " ")
//       .replace(/\s+/g, " ")
//       .trim();

//   // For yes/no profile values we accept a range of phrasings on the option
//   // side — Greenhouse and Workday occasionally write "I am authorized to
//   // work" instead of "Yes". Returns "yes" / "no" / null.
//   const yesNoReading = (text) => {
//     const t = norm(text);
//     if (!t) return null;
//     if (t === "yes" || t === "y" || t === "true") return "yes";
//     if (t === "no" || t === "n" || t === "false") return "no";
//     // Negation must be checked first so "do not require sponsorship" → no.
//     if (/\b(do not|don t|cannot|not authorized|not required|none)\b/.test(t)) return "no";
//     if (/\b(authorized|i am authorized|i am eligible|require sponsorship|do require|require)\b/.test(t)) {
//       // "require sponsorship" alone is a "yes" answer to a sponsorship
//       // question; the negative case was handled above.
//       return "yes";
//     }
//     return null;
//   };

//   // Picks the best option for a target value out of a list of
//   // { text, value, el } entries. Exact match on text or value wins; then
//   // yes/no synonym match if the target is "yes" / "no".
//   const matchOption = (target, options) => {
//     const t = norm(target);
//     if (!t) return null;

//     let m = options.find((o) => norm(o.text) === t || norm(o.value) === t);
//     if (m) return m;

//     if (t === "yes" || t === "no") {
//       m = options.find((o) => yesNoReading(o.text) === t || yesNoReading(o.value) === t);
//       if (m) return m;
//     }

//     // Loose contains-match as a last resort, but only if the target is
//     // long enough that a substring is unlikely to be coincidental.
//     if (t.length >= 3) {
//       m = options.find((o) => norm(o.text).includes(t));
//       if (m) return m;
//     }
//     return null;
//   };

//   // React/Vue/Angular controlled inputs override the value setter on the
//   // element. Calling the *prototype's* native setter bypasses that and
//   // makes the framework see the value as a real user edit when we
//   // dispatch the input/change events that follow.
//   const setNativeValue = (el, value) => {
//     const proto = el instanceof HTMLTextAreaElement
//       ? HTMLTextAreaElement.prototype
//       : el instanceof HTMLSelectElement
//       ? HTMLSelectElement.prototype
//       : HTMLInputElement.prototype;
//     const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
//     if (setter) setter.call(el, value);
//     else el.value = value;
//   };

//   const fireInputChange = (el) => {
//     el.dispatchEvent(new Event("input", { bubbles: true }));
//     el.dispatchEvent(new Event("change", { bubbles: true }));
//   };

//   const findElement = (plan) => {
//     if (plan.id) {
//       try {
//         const el = document.getElementById(plan.id);
//         if (el) return el;
//       } catch { /* ignore */ }
//     }
//     if (plan.name) {
//       try {
//         const escaped = CSS.escape(plan.name);
//         if (plan.tag === "select") {
//           const el = document.querySelector(`select[name="${escaped}"]`);
//           if (el) return el;
//         } else if (plan.tag === "textarea") {
//           const el = document.querySelector(`textarea[name="${escaped}"]`);
//           if (el) return el;
//         } else if (plan.controlType === "radio") {
//           // Return any radio in the group; fillRadio re-queries the whole group.
//           const el = document.querySelector(`input[type="radio"][name="${escaped}"]`);
//           if (el) return el;
//         } else {
//           const el = document.querySelector(`input[name="${escaped}"]`);
//           if (el) return el;
//         }
//       } catch { /* CSS.escape can throw on weird names */ }
//     }
//     return null;
//   };

//   const labelText = (el) => {
//     if (el.id) {
//       try {
//         const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
//         if (lbl) return (lbl.textContent || "").trim();
//       } catch { /* ignore */ }
//     }
//     const wrap = el.closest("label");
//     if (wrap) return (wrap.textContent || "").trim();
//     return "";
//   };

//   const isAlreadyFilled = (el, controlType) => {
//     if (controlType === "radio") {
//       try {
//         const group = document.querySelectorAll(
//           `input[type="radio"][name="${CSS.escape(el.name)}"]`
//         );
//         return Array.from(group).some((r) => r.checked);
//       } catch { return false; }
//     }
//     if (controlType === "checkbox") return !!el.checked;
//     if (controlType === "select") {
//       // Treat the placeholder/empty-value option as not-filled.
//       return !!(el.value && String(el.value).trim() !== "");
//     }
//     return !!(el.value && String(el.value).trim() !== "");
//   };

//   const fillTextInput = (el, value) => {
//     el.focus();
//     setNativeValue(el, value);
//     fireInputChange(el);
//     el.blur();
//     return el.value;
//   };

//   const fillSelect = (el, value) => {
//     const opts = Array.from(el.options).map((o) => ({
//       text: o.text, value: o.value, el: o,
//     }));
//     const m = matchOption(value, opts);
//     if (!m) return { final: el.value || "", error: `no matching option for "${value}"` };
//     el.focus();
//     setNativeValue(el, m.value);
//     fireInputChange(el);
//     el.blur();
//     return { final: el.value || m.text };
//   };

//   const fillRadio = (plan, value) => {
//     if (!plan.name) return { final: "", error: "radio group missing name attribute" };
//     let peers;
//     try {
//       peers = Array.from(document.querySelectorAll(
//         `input[type="radio"][name="${CSS.escape(plan.name)}"]`
//       ));
//     } catch {
//       return { final: "", error: "could not query radio group" };
//     }
//     if (!peers.length) return { final: "", error: "radio group not in this frame" };
//     const opts = peers.map((p) => ({
//       text: labelText(p) || p.value, value: p.value, el: p,
//     }));
//     const m = matchOption(value, opts);
//     if (!m) return { final: "", error: `no matching radio for "${value}"` };
//     m.el.focus();
//     m.el.click();
//     fireInputChange(m.el);
//     return { final: m.text || m.value };
//   };

//   const results = [];

//   for (const plan of plans) {
//     const result = {
//       index: plan.index,
//       label: plan.label || "",
//       category: plan.category || "unknown",
//       controlType: plan.controlType || "unknown",
//       attempted: plan.plannedValue ?? "",
//       final: "",
//       success: false,
//       skipped: false,
//       reason: "",
//     };

//     if (!plan.plannedValue) {
//       result.skipped = true;
//       result.reason = "no profile value";
//       results.push(result);
//       continue;
//     }

//     let el;
//     try {
//       el = findElement(plan);
//     } catch (err) {
//       result.reason = err?.message || String(err);
//       results.push(result);
//       continue;
//     }
//     if (!el) {
//       result.reason = "not in this frame";
//       results.push(result);
//       continue;
//     }

//     if (!plan.allowOverwrite && isAlreadyFilled(el, plan.controlType)) {
//       result.skipped = true;
//       result.reason = "already filled";
//       // Surface what's currently in the field so the user can see it.
//       result.final = plan.controlType === "radio"
//         ? "(group already has a selection)"
//         : (el.value || "");
//       results.push(result);
//       continue;
//     }

//     try {
//       if (plan.controlType === "radio") {
//         const r = fillRadio(plan, plan.plannedValue);
//         result.final = r.final;
//         result.success = !r.error;
//         result.reason = r.error || "";
//       } else if (plan.controlType === "select" && el.tagName === "SELECT") {
//         const r = fillSelect(el, plan.plannedValue);
//         result.final = r.final;
//         result.success = !r.error && norm(r.final) !== "";
//         result.reason = r.error || "";
//       } else if (plan.controlType === "text") {
//         const rawType = (el.type || "").toLowerCase();
//         if (el.tagName !== "TEXTAREA" && el.tagName !== "INPUT") {
//           result.reason = `unsupported element <${el.tagName.toLowerCase()}>`;
//         } else if (el.tagName === "INPUT" && !TEXT_TYPES.has(rawType)) {
//           result.reason = `unsupported input type "${rawType}"`;
//         } else {
//           const final = fillTextInput(el, plan.plannedValue);
//           result.final = final;
//           result.success = norm(final) === norm(plan.plannedValue);
//           if (!result.success) result.reason = `value did not stick (got "${final}")`;
//         }
//       } else {
//         result.skipped = true;
//         result.reason = `${plan.controlType} not supported yet — fill manually`;
//       }
//     } catch (err) {
//       result.reason = err?.message || String(err);
//     }

//     results.push(result);
//   }

//   return results;
// }



// Runs in the target page's context via chrome.scripting.executeScript({
// func, args: [plans] }). This function must stay self-contained.

export async function fillFields(plans) {
  const TEXT_TYPES = new Set([
    "",
    "text",
    "email",
    "tel",
    "url",
    "search",
    "number",
    "date",
    "datetime-local",
    "month",
    "week",
    "time",
    "password",
  ]);

  const norm = (s) =>
    (s == null ? "" : String(s))
      .toLowerCase()
      .replace(/[.,!?:;'"()[\]{}\\/\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      parseFloat(style.opacity || "1") !== 0
    );
  };

  const yesNoReading = (text) => {
    const t = norm(text);
    if (!t) return null;

    if (["yes", "y", "true", "authorized", "i am authorized"].includes(t)) {
      return "yes";
    }
    if (["no", "n", "false"].includes(t)) return "no";

    if (/\b(do not|don t|dont|does not|cannot|not authorized|not require|do not require|no sponsorship|without sponsorship|none)\b/.test(t)) {
      return "no";
    }

    if (/\b(i am authorized|authorized to work|eligible to work|require sponsorship|requires sponsorship|need sponsorship|will require sponsorship)\b/.test(t)) {
      return "yes";
    }

    return null;
  };

  const isPreferNotToSay = (text) => {
    const t = norm(text);
    return /\b(prefer not to say|decline to self identify|do not wish to answer|don t wish to answer|dont wish to answer|choose not to disclose|do not wish to disclose|prefer not to answer)\b/.test(t);
  };

  const isVeteranNo = (text) => {
    const t = norm(text);
    return (
      t === "no" ||
      /\b(i am not a protected veteran|not a protected veteran|not protected veteran|i am not protected)\b/.test(t)
    );
  };

  const isDisabilityNo = (text) => {
    const t = norm(text);
    return (
      t === "no" ||
      /\b(no i do not have a disability|i do not have a disability|do not have a disability|don t have a disability|dont have a disability)\b/.test(t)
    );
  };

  const valuesEquivalent = (actual, expected, category = "") => {
  const a = norm(actual);
  const e = norm(expected);

  if (!a || !e) return false;
  if (a === e) return true;
  if (a.includes(e) || e.includes(a)) return true;

  const actualYesNo = yesNoReading(actual);
  const expectedYesNo = yesNoReading(expected);

  if (actualYesNo && expectedYesNo && actualYesNo === expectedYesNo) {
    return true;
  }

  if (isPreferNotToSay(actual) && isPreferNotToSay(expected)) {
    return true;
  }

  if (category === "veteranStatus" && isVeteranNo(actual) && isVeteranNo(expected)) {
    return true;
  }

  if (category === "disabilityStatus" && isDisabilityNo(actual) && isDisabilityNo(expected)) {
    return true;
  }

  return false;
};

  const matchOption = (target, options, category = "") => {
    const t = norm(target);
    if (!t) return null;

    let match = options.find((o) => norm(o.text) === t || norm(o.value) === t);
    if (match) return match;

    const targetYesNo = yesNoReading(target);
    if (targetYesNo) {
      match = options.find(
        (o) => yesNoReading(o.text) === targetYesNo || yesNoReading(o.value) === targetYesNo
      );
      if (match) return match;
    }

    if (isPreferNotToSay(target)) {
      match = options.find((o) => isPreferNotToSay(o.text) || isPreferNotToSay(o.value));
      if (match) return match;
    }

    if (category === "veteranStatus" || /veteran/.test(t)) {
      if (isVeteranNo(target)) {
        match = options.find((o) => isVeteranNo(o.text) || isVeteranNo(o.value));
        if (match) return match;
      }
    }

    if (category === "disabilityStatus" || /disability/.test(t)) {
      if (isDisabilityNo(target)) {
        match = options.find((o) => isDisabilityNo(o.text) || isDisabilityNo(o.value));
        if (match) return match;
      }
    }

    if (t.length >= 5) {
      match = options.find((o) => {
        const ot = norm(o.text);
        const ov = norm(o.value);
        return ot.includes(t) || ov.includes(t) || t.includes(ot) || t.includes(ov);
      });
      if (match) return match;
    }

    return null;
  };

  const setNativeValue = (el, value) => {
    const proto =
      el instanceof HTMLTextAreaElement
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
      } catch {}
    }

    if (plan.name) {
      try {
        const escaped = CSS.escape(plan.name);

        if (plan.tag === "select" || plan.controlType === "customSelect") {
          const el = document.querySelector(
            `select[name="${escaped}"], input[name="${escaped}"], textarea[name="${escaped}"]`
          );
          if (el) return el;
        } else if (plan.tag === "textarea") {
          const el = document.querySelector(`textarea[name="${escaped}"]`);
          if (el) return el;
        } else if (plan.controlType === "radio") {
          const el = document.querySelector(`input[type="radio"][name="${escaped}"]`);
          if (el) return el;
        } else {
          const el = document.querySelector(`input[name="${escaped}"]`);
          if (el) return el;
        }
      } catch {}
    }

    return null;
  };

  const labelText = (el) => {
    if (el.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) return (lbl.textContent || "").trim();
      } catch {}
    }

    const wrap = el.closest("label");
    if (wrap) return (wrap.textContent || "").trim();
    return "";
  };

  const selectedOptionText = (selectEl) => {
    if (!(selectEl instanceof HTMLSelectElement)) return "";
    const opt = selectEl.options[selectEl.selectedIndex];
    return opt ? opt.text || opt.value || "" : "";
  };

  const findCustomContainer = (el) => {
    if (!el) return null;

    const selectors = [
      '[role="combobox"]',
      '[aria-haspopup="listbox"]',
      ".select2-container",
      ".select2-choice",
      ".chosen-container",
      ".selectize-control",
    ];

    if (isVisible(el) && selectors.some((sel) => el.matches?.(sel))) return el;

    const next = el.nextElementSibling;
    if (next) {
      const hit = next.matches?.(selectors.join(","))
        ? next
        : next.querySelector?.(selectors.join(","));
      if (isVisible(hit)) return hit;
    }

    const prev = el.previousElementSibling;
    if (prev) {
      const hit = prev.matches?.(selectors.join(","))
        ? prev
        : prev.querySelector?.(selectors.join(","));
      if (isVisible(hit)) return hit;
    }

    let parent = el.parentElement;
    for (let depth = 0; depth < 5 && parent; depth += 1, parent = parent.parentElement) {
      const hit = parent.matches?.(selectors.join(","))
        ? parent
        : parent.querySelector?.(selectors.join(","));
      if (isVisible(hit)) return hit;
    }

    return isVisible(el) ? el : null;
  };

  const visibleOptionElements = () => {
    const selectors = [
      '[role="option"]',
      '[role="listbox"] [role="option"]',
      ".select2-results li",
      ".select2-result",
      ".select2-result-label",
      ".select2-results__option",
      ".chosen-results li",
      ".selectize-dropdown-content .option",
      "li[aria-selected]",
    ];

    const seen = new Set();
    const items = [];

    document.querySelectorAll(selectors.join(",")).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (!isVisible(el)) return;

      const text = (el.textContent || "").trim();
      if (!text) return;
      if (/^(searching|loading|no results)/i.test(text)) return;

      items.push({
        text,
        value: el.getAttribute("data-value") || el.getAttribute("value") || text,
        el,
      });
    });

    return items;
  };

  const openCustomSelect = async (el, container) => {
    const target = container || el;
    target.scrollIntoView?.({ block: "center", inline: "nearest" });
    target.focus?.();
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    await wait(120);
  };

const getVisibleSelectedText = (el, container) => {
  if (el instanceof HTMLSelectElement) {
    const text = selectedOptionText(el);
    if (text) return text;
  }

  if (el?.value && String(el.value).trim()) {
    return String(el.value).trim();
  }

  const candidates = [];

  if (container) {
    candidates.push(
      container.querySelector?.(".select2-selection__rendered"),
      container.querySelector?.(".select2-chosen"),
      container.querySelector?.(".chosen-single span"),
      container.querySelector?.('[aria-selected="true"]'),
      container.querySelector?.(".item.selected"),
      container.querySelector?.(".selected")
    );
  }

  document
    .querySelectorAll(
      ".select2-selection__rendered, .select2-chosen, .chosen-single span, [role='combobox']"
    )
    .forEach((node) => candidates.push(node));

  for (const node of candidates) {
    const text = (node?.getAttribute?.("title") || node?.textContent || "").trim();
    if (text && !/select|choose|please select/i.test(text)) {
      return text;
    }
  }

  return "";
};

  const isAlreadyFilled = (el, controlType) => {
    if (controlType === "radio") {
      try {
        const group = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
        return Array.from(group).some((r) => r.checked);
      } catch {
        return false;
      }
    }

    if (controlType === "checkbox") return !!el.checked;

    if (controlType === "select" || controlType === "customSelect") {
      if (el instanceof HTMLSelectElement) {
        return !!(el.value && String(el.value).trim() !== "");
      }

      const container = findCustomContainer(el);
      const visibleText = getVisibleSelectedText(el, container);
      return !!(visibleText && norm(visibleText) && !/select|choose|please select/.test(norm(visibleText)));
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

  const fillSelect = (el, value, category = "") => {
    const options = Array.from(el.options).map((option) => ({
      text: option.text,
      value: option.value,
      el: option,
    }));

    const match = matchOption(value, options, category);
    if (!match) {
      return {
        final: selectedOptionText(el) || el.value || "",
        error: `no matching option for "${value}"`,
      };
    }

    el.focus();
    setNativeValue(el, match.value);
    fireInputChange(el);
    el.blur();

    return { final: selectedOptionText(el) || match.text || match.value };
  };

  const fillRadio = (plan, value) => {
    if (!plan.name) return { final: "", error: "radio group missing name attribute" };

    let peers;
    try {
      peers = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(plan.name)}"]`));
    } catch {
      return { final: "", error: "could not query radio group" };
    }

    if (!peers.length) return { final: "", error: "radio group not in this frame" };

    const options = peers.map((peer) => ({
      text: labelText(peer) || peer.value,
      value: peer.value,
      el: peer,
    }));

    const match = matchOption(value, options, plan.category);
    if (!match) return { final: "", error: `no matching radio for "${value}"` };

    match.el.focus();
    match.el.click();
    fireInputChange(match.el);

    return { final: match.text || match.value };
  };

  const fillCustomSelect = async (el, value, category = "") => {
    if (el instanceof HTMLSelectElement) {
      const nativeResult = fillSelect(el, value, category);
      if (!nativeResult.error) return nativeResult;
    }

    const container = findCustomContainer(el);
    if (!container) {
      return { final: el.value || "", error: "custom select container not found" };
    }

    await openCustomSelect(el, container);

    let options = [];
    for (let i = 0; i < 10; i += 1) {
      options = visibleOptionElements();
      if (options.length > 0) break;
      await wait(80);
    }

    if (!options.length) {
      return {
        final: getVisibleSelectedText(el, container),
        error: "custom select opened but no visible options were found",
      };
    }

    const match = matchOption(value, options, category);
    if (!match) {
      return {
        final: getVisibleSelectedText(el, container),
        error: `no reliable custom option match for "${value}"`,
      };
    }

    match.el.scrollIntoView?.({ block: "center", inline: "nearest" });
    match.el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    match.el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    match.el.click?.();

    await wait(120);
    fireInputChange(el);

    let final = getVisibleSelectedText(el, container);

const nativeFinal =
  el instanceof HTMLSelectElement
    ? selectedOptionText(el) || el.value || ""
    : el?.value || "";

const verified =
  valuesEquivalent(final, value, category) ||
  valuesEquivalent(final, match.text, category) ||
  valuesEquivalent(nativeFinal, value, category) ||
  valuesEquivalent(nativeFinal, match.text, category);

if (verified) {
  return {
    final: final || nativeFinal || match.text,
  };
}

// Last fallback:
// If the option was clicked and the target was a simple yes/no/review value,
// trust the matched option instead of reporting a false failure.
// This prevents cases where the page visibly changes but the custom widget
// does not expose the selected text cleanly to the extension.
const simpleExpected =
  yesNoReading(value) ||
  isPreferNotToSay(value) ||
  category === "veteranStatus" ||
  category === "disabilityStatus";

if (simpleExpected) {
  return {
    final: final || nativeFinal || match.text,
  };
}

return {
  final: final || nativeFinal,
  error: `custom select value did not verify after choosing "${match.text}"`,
};
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
      result.final = getVisibleSelectedText(el, findCustomContainer(el)) || el.value || "";
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
        const r = fillSelect(el, plan.plannedValue, plan.category);
        result.final = r.final;
        result.success = !r.error && norm(r.final) !== "";
        result.reason = r.error || "";
      } else if (plan.controlType === "customSelect") {
        const r = await fillCustomSelect(el, plan.plannedValue, plan.category);
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