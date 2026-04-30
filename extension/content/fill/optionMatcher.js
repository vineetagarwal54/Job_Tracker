(() => {
  const JT = globalThis.JobTrackAutofill;
  if (!JT) return;

  const normalizeText =
    JT.utils?.normalizeText ||
    ((value) =>
      (value == null ? "" : String(value))
        .toLowerCase()
        .replace(/[.,!?:;'"()[\]{}\\/\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim());

  const normalizeOptionText = (value) => normalizeText(value);

  const yesNoReading = (text) => {
    const t = normalizeText(text);
    if (!t) return null;

    const yesPatterns = [
      /^yes$/,
      /^y$/,
      /^true$/,
      /\bi am authorized\b/,
      /\bauthorized to work\b/,
      /\blegally authorized\b/,
      /\beligible to work\b/,
      /\bright to work\b/,
      /\bi can work\b/,
      /\bi am able to work\b/,
    ];

    const noPatterns = [
      /^no$/,
      /^n$/,
      /^false$/,
      /\bnot authorized\b/,
      /\bnot eligible\b/,
      /\bdo not require sponsorship\b/,
      /\bdon t require sponsorship\b/,
      /\bdont require sponsorship\b/,
      /\bdoes not require sponsorship\b/,
      /\bwithout sponsorship\b/,
      /\bno sponsorship\b/,
      /\bi do not need sponsorship\b/,
      /\bi don t need sponsorship\b/,
      /\bi dont need sponsorship\b/,
    ];

    if (yesPatterns.some((pattern) => pattern.test(t))) return "yes";
    if (noPatterns.some((pattern) => pattern.test(t))) return "no";

    return null;
  };

  const isPreferNotToSay = (text) => {
    const t = normalizeText(text);

    return [
      "prefer not to say",
      "prefer not to answer",
      "decline to self identify",
      "decline to self identify",
      "decline to disclose",
      "choose not to disclose",
      "i do not wish to answer",
      "i don t wish to answer",
      "i dont wish to answer",
      "i do not wish to disclose",
      "i don t wish to disclose",
      "i dont wish to disclose",
    ].some((phrase) => t.includes(phrase));
  };

  const isVeteranNo = (text) => {
    const t = normalizeText(text);

    return (
      t === "no" ||
      t.includes("i am not a protected veteran") ||
      t.includes("not a protected veteran") ||
      t.includes("not protected veteran") ||
      t.includes("i am not protected")
    );
  };

  const isDisabilityNo = (text) => {
    const t = normalizeText(text);

    return (
      t === "no" ||
      t.includes("no i do not have a disability") ||
      t.includes("i do not have a disability") ||
      t.includes("do not have a disability") ||
      t.includes("don t have a disability") ||
      t.includes("dont have a disability")
    );
  };

  const genderReading = (text) => {
    const t = normalizeText(text);
    if (!t) return null;

    if (["male", "man", "m"].includes(t)) return "male";
    if (["female", "woman", "f"].includes(t)) return "female";
    if (t.includes("non binary") || t.includes("nonbinary")) return "nonbinary";
    if (isPreferNotToSay(t)) return "preferNotToSay";

    return null;
  };

  const valuesEquivalent = (actual, expected, category = "") => {
    const a = normalizeText(actual);
    const e = normalizeText(expected);

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

    if (category === "gender" && genderReading(actual) === genderReading(expected)) {
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

  const matchOption = (targetValue, options, category = "") => {
    const target = normalizeText(targetValue);
    if (!target || !Array.isArray(options) || options.length === 0) return null;

    const normalizedOptions = options.map((option) => ({
      ...option,
      normalizedText: normalizeText(option.text),
      normalizedValue: normalizeText(option.value),
    }));

    // 1. Exact match
    let match = normalizedOptions.find(
      (option) =>
        option.normalizedText === target ||
        option.normalizedValue === target
    );
    if (match) return match;

    // 2. Equivalent value match: yes/no, EEO, gender, veteran, disability
    match = normalizedOptions.find(
      (option) =>
        valuesEquivalent(option.text, targetValue, category) ||
        valuesEquivalent(option.value, targetValue, category)
    );
    if (match) return match;

    // 3. Conservative contains match
    // Only use this for longer values to avoid matching "no" inside unrelated words.
    if (target.length >= 5) {
      match = normalizedOptions.find((option) => {
        const text = option.normalizedText;
        const value = option.normalizedValue;

        return (
          (text && text.includes(target)) ||
          (value && value.includes(target)) ||
          (text && target.includes(text) && text.length >= 5) ||
          (value && target.includes(value) && value.length >= 5)
        );
      });

      if (match) return match;
    }

    return null;
  };

  JT.matchers = {
    ...JT.matchers,
    normalizeOptionText,
    yesNoReading,
    isPreferNotToSay,
    isVeteranNo,
    isDisabilityNo,
    genderReading,
    valuesEquivalent,
    matchOption,
  };
})();