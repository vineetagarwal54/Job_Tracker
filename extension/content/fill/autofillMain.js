(() => {
  const JT = globalThis.JobTrackAutofill;
  if (!JT) return;

  const { normalizeText } = JT.utils || {};

  const {
    findElement,
    isAlreadyFilled,
    findCustomSelectContainer,
    getSelectedDisplayText,
  } = JT.locators || {};

  const {
    fillTextInput,
    fillNativeSelect,
    fillRadio,
    fillCheckbox,
    fillCustomSelect,
  } = JT.fillers || {};

  const createEmptyResult = (plan) => ({
    index: plan.index,
    label: plan.label || "",
    category: plan.category || "unknown",
    controlType: plan.controlType || "unknown",
    attempted: plan.plannedValue ?? "",
    final: "",
    success: false,
    skipped: false,
    reason: "",
  });

  const readFinalValue = (el, plan) => {
    if (!el) return "";

    if (plan.controlType === "customSelect") {
      const container = findCustomSelectContainer?.(el);
      return getSelectedDisplayText?.(el, container) || el.value || "";
    }

    if (el instanceof HTMLSelectElement) {
      const option = el.options[el.selectedIndex];
      return option?.text || el.value || "";
    }

    if (plan.controlType === "checkbox") {
      return el.checked ? "checked" : "unchecked";
    }

    return el.value || "";
  };

  const fillOnePlan = async (plan) => {
    const result = createEmptyResult(plan);

    if (!plan.plannedValue) {
      result.skipped = true;
      result.reason = "no profile value";
      return result;
    }

    const el = findElement?.(plan);

    if (!el) {
      result.reason = "not in this frame";
      return result;
    }

    if (!plan.allowOverwrite && isAlreadyFilled?.(el, plan)) {
      result.skipped = true;
      result.reason = "already filled";
      result.final = readFinalValue(el, plan);
      return result;
    }

    let fillResult = {
      final: "",
      error: "unsupported control type",
    };

    if (plan.controlType === "text") {
      fillResult = fillTextInput?.(el, plan.plannedValue, plan.expectedType) || fillResult;
    } else if (plan.controlType === "select") {
      fillResult = fillNativeSelect?.(el, plan.plannedValue, plan.category) || fillResult;
    } else if (plan.controlType === "radio") {
      fillResult = fillRadio?.(plan, el, plan.plannedValue) || fillResult;
    } else if (plan.controlType === "checkbox") {
      fillResult = fillCheckbox?.(el, plan.plannedValue) || fillResult;
    } else if (plan.controlType === "customSelect") {
      fillResult =
        (await fillCustomSelect?.(el, plan.plannedValue, plan.category)) || fillResult;
    } else {
      result.skipped = true;
      result.reason = `${plan.controlType} not supported yet — fill manually`;
      return result;
    }

    result.final = fillResult.final || readFinalValue(el, plan);
    result.success = !fillResult.error && Boolean(normalizeText ? normalizeText(result.final) : result.final);
    result.reason = fillResult.error || "";

    return result;
  };

  const fillFields = async (plans = []) => {
    const results = [];

    for (const plan of plans) {
      try {
        results.push(await fillOnePlan(plan));
      } catch (error) {
        const result = createEmptyResult(plan);
        result.reason = error?.message || String(error);
        results.push(result);
      }
    }

    return results;
  };

  JT.createEmptyResult = createEmptyResult;
  JT.fillOnePlan = fillOnePlan;
  JT.fillFields = fillFields;
})();