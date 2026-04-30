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

  const { matchOption, valuesEquivalent, yesNoReading } = JT.matchers || {};
  const { labelText, selectedOptionText, findRadioGroup } = JT.locators || {};

  const fillTextInput = (el, value) => {
    if (!el) return { final: "", error: "text input not found" };
    if (!setNativeValue || !fireInputChange) {
      return { final: "", error: "DOM utility functions not loaded" };
    }

    scrollAndFocus?.(el);
    setNativeValue(el, value);
    fireInputChange(el);
    el.blur?.();

    const final = el.value || "";
    const success = valuesEquivalent
      ? valuesEquivalent(final, value)
      : normalizeText(final) === normalizeText(value);

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
    fillTextInput,
    fillNativeSelect,
    fillRadio,
    fillCheckbox,
  };
})();