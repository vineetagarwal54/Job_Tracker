(() => {
  const JT = globalThis.JobTrackAutofill;
  if (!JT) return;

  const normalizeText = (value) =>
    (value == null ? "" : String(value))
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

  const safeCssEscape = (value) => {
    try {
      return CSS.escape(String(value));
    } catch {
      return String(value).replace(/"/g, '\\"');
    }
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

  const scrollAndFocus = (el) => {
    el.scrollIntoView?.({ block: "center", inline: "nearest" });
    el.focus?.();
  };

  JT.utils = {
    ...JT.utils,
    normalizeText,
    wait,
    isVisible,
    safeCssEscape,
    setNativeValue,
    fireInputChange,
    scrollAndFocus,
  };
})();