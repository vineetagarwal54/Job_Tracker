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
    setNativeValue,
    fireInputChange,
    scrollAndFocus,
  } = JT.utils || {};

  const {
    matchOption,
    valuesEquivalent,
    yesNoReading,
    yearFrom,
    monthYearFrom,
  } = JT.matchers || {};

  const { labelText, selectedOptionText, findRadioGroup } = JT.locators || {};

  const MONTHS = {
    january: "01", jan: "01",
    february: "02", feb: "02",
    march: "03", mar: "03",
    april: "04", apr: "04",
    may: "05",
    june: "06", jun: "06",
    july: "07", jul: "07",
    august: "08", aug: "08",
    september: "09", sep: "09", sept: "09",
    october: "10", oct: "10",
    november: "11", nov: "11",
    december: "12", dec: "12",
  };

  const pad2 = (value) => String(value).padStart(2, "0");

  // Generic value formatter. Picks an output format based on the field's
  // input type and (optionally) the expectedType the matcher inferred.
  // Falls through unchanged when nothing matches — never throws.
  const formatValueForField = (el, value, expectedType = "") => {
    const rawValue = value == null ? "" : String(value).trim();
    if (!rawValue) return rawValue;

    const inputType = (el instanceof HTMLInputElement && (el.type || "").toLowerCase()) || "";

    // 1. Format by HTML input type — these have strict accepted formats.
    if (inputType === "date") return toIsoDate(rawValue) || rawValue;
    if (inputType === "month") return toIsoMonth(rawValue) || rawValue;

    // 2. Format by expectedType for inputs without a strict native format.
    if (expectedType === "year") {
      const y = yearFrom?.(rawValue);
      if (y != null) return String(y);
    }

    if (expectedType === "monthYear") {
      const my = monthYearFrom?.(rawValue);
      if (my && (inputType === "text" || inputType === "" || inputType === "search")) {
        return `${my.year}-${pad2(my.month)}`;
      }
    }

    if (expectedType === "yesNo") {
      const yn = yesNoReading?.(rawValue);
      if (yn === "yes") return "Yes";
      if (yn === "no") return "No";
    }

    return rawValue;
  };

  const toIsoDate = (rawValue) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) return rawValue;

    const monthNameMatch = rawValue.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (monthNameMatch) {
      const [, monthName, day, year] = monthNameMatch;
      const month = MONTHS[monthName.toLowerCase()];
      if (month) return `${year}-${month}-${pad2(day)}`;
    }

    const slashMatch = rawValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const [, month, day, year] = slashMatch;
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }

    // "August 2024" with no day — fall back to the 1st.
    const monthYear = rawValue.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (monthYear) {
      const month = MONTHS[monthYear[1].toLowerCase()];
      if (month) return `${monthYear[2]}-${month}-01`;
    }

    return null;
  };

  const toIsoMonth = (rawValue) => {
    if (/^\d{4}-\d{2}$/.test(rawValue)) return rawValue;

    const monthYearMatch = rawValue.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (monthYearMatch) {
      const [, monthName, year] = monthYearMatch;
      const month = MONTHS[monthName.toLowerCase()];
      if (month) return `${year}-${month}`;
    }

    const fullDateMatch = rawValue.match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (fullDateMatch) {
      const [, year, month] = fullDateMatch;
      return `${year}-${month}`;
    }

    return null;
  };

  const fillTextInput = (el, value, expectedType = "") => {
    if (!el) return { final: "", error: "text input not found" };
    if (!setNativeValue || !fireInputChange) {
      return { final: "", error: "DOM utility functions not loaded" };
    }

    const valueToFill = formatValueForField(el, value, expectedType);

    scrollAndFocus?.(el);
    setNativeValue(el, valueToFill);
    fireInputChange(el);
    el.blur?.();

    const final = el.value || "";

    const success = valuesEquivalent
      ? valuesEquivalent(final, valueToFill) || valuesEquivalent(final, value)
      : normalizeText(final) === normalizeText(valueToFill) ||
        normalizeText(final) === normalizeText(value);

    return {
      final,
      error: success ? "" : `value did not stick (got "${final}")`,
    };
  };

  const fillNativeSelect = (el, value, category = "") => {
    if (!(el instanceof HTMLSelectElement)) {
      return { final: "", error: "native select element not found" };
    }

    if (!matchOption || !setNativeValue || !fireInputChange) {
      return {
        final: selectedOptionText?.(el) || el.value || "",
        error: "select helper functions not loaded",
      };
    }

    const options = Array.from(el.options).map((option) => ({
      text: option.text || option.label || option.value || "",
      value: option.value || option.text || "",
      el: option,
    }));

    const match = matchOption(value, options, category);

    if (!match) {
      return {
        final: selectedOptionText?.(el) || el.value || "",
        error: `no matching option for "${value}"`,
      };
    }

    scrollAndFocus?.(el);
    setNativeValue(el, match.value);
    fireInputChange(el);
    el.blur?.();

    const final = selectedOptionText?.(el) || el.value || match.text || match.value || "";

    const success = valuesEquivalent
      ? valuesEquivalent(final, value, category) || valuesEquivalent(final, match.text, category)
      : normalizeText(final) === normalizeText(value);

    return {
      final,
      error: success ? "" : `selected value did not verify after choosing "${match.text}"`,
    };
  };

  const fillRadio = (plan, firstElement, value) => {
    const radios = findRadioGroup?.(plan, firstElement) || [];

    if (!radios.length) {
      return { final: "", error: "radio group not found" };
    }

    if (!matchOption || !fireInputChange) {
      return { final: "", error: "radio helper functions not loaded" };
    }

    const options = radios.map((radio) => ({
      text: labelText?.(radio) || radio.value || "",
      value: radio.value || labelText?.(radio) || "",
      el: radio,
    }));

    const match = matchOption(value, options, plan?.category || "");

    if (!match) {
      return { final: "", error: `no matching radio for "${value}"` };
    }

    scrollAndFocus?.(match.el);
    match.el.click();
    fireInputChange(match.el);

    return {
      final: match.text || match.value || "",
      error: match.el.checked ? "" : `radio value did not verify after choosing "${match.text}"`,
    };
  };

  const fillCheckbox = (el, value) => {
    if (!el || el.type !== "checkbox") {
      return { final: "", error: "checkbox element not found" };
    }

    const desired = yesNoReading?.(value);

    if (!desired) {
      return {
        final: el.checked ? "checked" : "unchecked",
        error: `checkbox value "${value}" is not a clear yes/no answer`,
      };
    }

    const shouldCheck = desired === "yes";

    scrollAndFocus?.(el);

    if (el.checked !== shouldCheck) {
      el.click();
      fireInputChange?.(el);
    }

    return {
      final: el.checked ? "checked" : "unchecked",
      error: el.checked === shouldCheck
        ? ""
        : `checkbox did not change to ${shouldCheck ? "checked" : "unchecked"}`,
    };
  };

  JT.fillers = {
    ...JT.fillers,
    formatValueForField,
    fillTextInput,
    fillNativeSelect,
    fillRadio,
    fillCheckbox,
  };
})();
