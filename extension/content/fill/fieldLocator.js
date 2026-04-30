(() => {
  const JT = globalThis.JobTrackAutofill;
  if (!JT) return;

  const {
    normalizeText = (value) =>
      (value == null ? "" : String(value))
        .toLowerCase()
        .replace(/[.,!?:;'"()[\]{}\\/\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    isVisible = () => true,
    safeCssEscape = (value) => String(value).replace(/"/g, '\\"'),
  } = JT.utils || {};

  const selectedOptionText = (selectEl) => {
    if (!(selectEl instanceof HTMLSelectElement)) return "";
    const option = selectEl.options[selectEl.selectedIndex];
    return option ? option.text || option.value || "" : "";
  };

  const labelText = (el) => {
    if (!el) return "";

    if (el.id) {
      try {
        const label = document.querySelector(`label[for="${safeCssEscape(el.id)}"]`);
        if (label) return (label.textContent || "").trim();
      } catch {}
    }

    const wrappingLabel = el.closest?.("label");
    if (wrappingLabel) return (wrappingLabel.textContent || "").trim();

    const ariaLabel = el.getAttribute?.("aria-label");
    if (ariaLabel) return ariaLabel.trim();

    const labelledBy = el.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .trim();

      if (text) return text;
    }

    return "";
  };

  const findById = (plan) => {
    if (!plan?.id) return null;

    try {
      return document.getElementById(plan.id);
    } catch {
      return null;
    }
  };

  const findByName = (plan) => {
    if (!plan?.name) return null;

    try {
      const name = safeCssEscape(plan.name);
      const selector = [
        `input[name="${name}"]`,
        `select[name="${name}"]`,
        `textarea[name="${name}"]`,
        `[name="${name}"]`,
      ].join(",");

      const candidates = Array.from(document.querySelectorAll(selector));
      return candidates.find(isVisible) || candidates[0] || null;
    } catch {
      return null;
    }
  };

  const findByLabelText = (plan) => {
    const expected = normalizeText(plan?.label || "");
    if (!expected) return null;

    const labels = Array.from(document.querySelectorAll("label"));

    for (const label of labels) {
      const text = normalizeText(label.textContent || "");
      if (!text || (!text.includes(expected) && !expected.includes(text))) continue;

      if (label.htmlFor) {
        const target = document.getElementById(label.htmlFor);
        if (target && isVisible(target)) return target;
      }

      const nested = label.querySelector("input, select, textarea, [role='combobox']");
      if (nested && isVisible(nested)) return nested;
    }

    return null;
  };

  const findElement = (plan) => {
    return findById(plan) || findByName(plan) || findByLabelText(plan);
  };

  const findRadioGroup = (plan, firstElement) => {
    const name = plan?.name || firstElement?.name;
    if (!name) return firstElement ? [firstElement] : [];

    try {
      return Array.from(
        document.querySelectorAll(`input[type="radio"][name="${safeCssEscape(name)}"]`)
      );
    } catch {
      return firstElement ? [firstElement] : [];
    }
  };

  const findCustomSelectContainer = (el) => {
    if (!el) return null;

    const selectors = [
      '[role="combobox"]',
      '[aria-haspopup="listbox"]',
      ".select2-container",
      ".select2-choice",
      ".select2-selection",
      ".chosen-container",
      ".selectize-control",
      ".react-select__control",
      ".css-13cymwt-control",
      ".css-t3ipsp-control",
    ];

    const selectorText = selectors.join(",");

    try {
      if (el.matches?.(selectorText) && isVisible(el)) return el;
    } catch {}

    for (const sibling of [el.nextElementSibling, el.previousElementSibling]) {
      if (!sibling) continue;

      try {
        if (sibling.matches?.(selectorText) && isVisible(sibling)) return sibling;
        const hit = sibling.querySelector?.(selectorText);
        if (hit && isVisible(hit)) return hit;
      } catch {}
    }

    let parent = el.parentElement;
    for (let depth = 0; depth < 6 && parent; depth += 1, parent = parent.parentElement) {
      try {
        if (parent.matches?.(selectorText) && isVisible(parent)) return parent;
        const hit = parent.querySelector?.(selectorText);
        if (hit && isVisible(hit)) return hit;
      } catch {}
    }

    return isVisible(el) ? el : null;
  };

  const getSelectedDisplayText = (el, container = null) => {
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
      if (text && !/select|choose|please select/i.test(text)) return text;
    }

    return "";
  };

  const isAlreadyFilled = (el, plan = {}) => {
    if (!el) return false;

    if (plan.controlType === "radio") {
      return findRadioGroup(plan, el).some((radio) => radio.checked);
    }

    if (plan.controlType === "checkbox") {
      return Boolean(el.checked);
    }

    if (plan.controlType === "select") {
      if (el instanceof HTMLSelectElement) {
        return Boolean(el.value && String(el.value).trim());
      }
    }

    if (plan.controlType === "customSelect") {
      const container = findCustomSelectContainer(el);
      const text = getSelectedDisplayText(el, container);
      return Boolean(text && !/select|choose|please select/i.test(text));
    }

    return Boolean(el.value && String(el.value).trim());
  };

  JT.locators = {
    ...JT.locators,
    selectedOptionText,
    labelText,
    findById,
    findByName,
    findByLabelText,
    findElement,
    findRadioGroup,
    findCustomSelectContainer,
    getSelectedDisplayText,
    isAlreadyFilled,
  };
})();