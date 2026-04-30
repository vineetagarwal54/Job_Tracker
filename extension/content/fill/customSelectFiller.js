(() => {
  const JT = globalThis.JobTrackAutofill;
  if (!JT) return;

  const {
    wait,
    isVisible,
    scrollAndFocus,
    fireInputChange,
  } = JT.utils || {};

  const {
    matchOption,
    valuesEquivalent,
    yesNoReading,
    isPreferNotToSay,
  } = JT.matchers || {};

  const {
    findCustomSelectContainer,
    getSelectedDisplayText,
    selectedOptionText,
  } = JT.locators || {};

  const { fillNativeSelect } = JT.fillers || {};

  const openCustomSelect = async (el, container) => {
    const target = container || el;
    if (!target) return;

    scrollAndFocus?.(target);

    target.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
    );
    target.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
    );
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    );

    await wait?.(120);
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
      ".react-select__option",
      "li[aria-selected]",
    ];

    const seen = new Set();
    const items = [];

    document.querySelectorAll(selectors.join(",")).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);

      if (isVisible && !isVisible(el)) return;

      const text = (el.textContent || "").trim();
      if (!text) return;
      if (/^(searching|loading|no results|no options)/i.test(text)) return;

      items.push({
        text,
        value: el.getAttribute("data-value") || el.getAttribute("value") || text,
        el,
      });
    });

    return items;
  };

  const trySearchInput = async (value) => {
    const input = Array.from(
      document.querySelectorAll(
        '.select2-search__field, .select2-input, .chosen-search input, .selectize-input input, input[role="combobox"], input[aria-autocomplete="list"]'
      )
    ).find((node) => !isVisible || isVisible(node));

    if (!input) return false;

    input.focus?.();
    input.value = "";
    fireInputChange?.(input);

    input.value = String(value || "");
    fireInputChange?.(input);

    await wait?.(180);
    return true;
  };

  const clickCustomOption = async (option) => {
    if (!option?.el) return;

    option.el.scrollIntoView?.({ block: "center", inline: "nearest" });

    option.el.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
    );
    option.el.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
    );
    option.el.click?.();

    await wait?.(150);
  };

  const verifyCustomSelect = (el, container, expectedValue, matchedOption, category = "") => {
    const final = getSelectedDisplayText?.(el, container) || "";

    const nativeFinal =
      el instanceof HTMLSelectElement
        ? selectedOptionText?.(el) || el.value || ""
        : el?.value || "";

    const verified =
      valuesEquivalent?.(final, expectedValue, category) ||
      valuesEquivalent?.(final, matchedOption?.text, category) ||
      valuesEquivalent?.(nativeFinal, expectedValue, category) ||
      valuesEquivalent?.(nativeFinal, matchedOption?.text, category);

    if (verified) {
      return {
        final: final || nativeFinal || matchedOption?.text || "",
        error: "",
      };
    }

    const simpleExpected =
      yesNoReading?.(expectedValue) ||
      isPreferNotToSay?.(expectedValue) ||
      category === "gender" ||
      category === "veteranStatus" ||
      category === "disabilityStatus";

    if (simpleExpected && matchedOption?.text) {
      return {
        final: final || nativeFinal || matchedOption.text,
        error: "",
      };
    }

    return {
      final: final || nativeFinal || "",
      error: `custom select value did not verify after choosing "${matchedOption?.text || expectedValue}"`,
    };
  };

  const fillCustomSelect = async (el, value, category = "") => {
    if (!el) {
      return { final: "", error: "custom select element not found" };
    }

    if (el instanceof HTMLSelectElement && fillNativeSelect) {
      const nativeResult = fillNativeSelect(el, value, category);
      if (!nativeResult.error) return nativeResult;
    }

    const container = findCustomSelectContainer?.(el);

    if (!container) {
      return {
        final: el.value || "",
        error: "custom select container not found",
      };
    }

    await openCustomSelect(el, container);

    let options = [];

    for (let attempt = 0; attempt < 8; attempt += 1) {
      options = visibleOptionElements();
      if (options.length) break;
      await wait?.(80);
    }

    if (!options.length) {
      await trySearchInput(value);

      for (let attempt = 0; attempt < 8; attempt += 1) {
        options = visibleOptionElements();
        if (options.length) break;
        await wait?.(80);
      }
    }

    if (!options.length) {
      return {
        final: getSelectedDisplayText?.(el, container) || "",
        error: "custom select opened but no visible options were found",
      };
    }

    let match = matchOption?.(value, options, category);

    if (!match) {
      await trySearchInput(value);
      await wait?.(120);

      options = visibleOptionElements();
      match = matchOption?.(value, options, category);
    }

    if (!match) {
      return {
        final: getSelectedDisplayText?.(el, container) || "",
        error: `no reliable custom option match for "${value}"`,
      };
    }

    await clickCustomOption(match);
    fireInputChange?.(el);

    return verifyCustomSelect(el, container, value, match, category);
  };

  JT.fillers = {
    ...JT.fillers,
    openCustomSelect,
    visibleOptionElements,
    trySearchInput,
    clickCustomOption,
    verifyCustomSelect,
    fillCustomSelect,
  };
})();