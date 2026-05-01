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

  const MONTH_NAMES = {
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sep: 9, sept: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
  };

  // ── Yes / No ────────────────────────────────────────────────────────
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

  // ── Prefer-not-to-say / decline-to-self-identify ───────────────────
  const isPreferNotToSay = (text) => {
    const t = normalizeText(text);

    return [
      "prefer not to say",
      "prefer not to answer",
      "decline to self identify",
      "decline to identify",
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

  // ── EEO readings ────────────────────────────────────────────────────
  const isVeteranNo = (text) => {
    const t = normalizeText(text);

    return (
      t === "no" ||
      t.includes("i am not a protected veteran") ||
      t.includes("not a protected veteran") ||
      t.includes("not protected veteran") ||
      t.includes("i am not protected") ||
      t.includes("i am not a veteran") ||
      t.includes("not a veteran or active military") ||
      t.includes("not a veteran or active") ||
      t.includes("not a veteran") ||
      t.includes("not active military")
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

  const raceReading = (text) => {
    const t = normalizeText(text);
    if (!t) return null;

    if (
      t.includes("asian") ||
      t.includes("east asian") ||
      t.includes("south asian") ||
      t.includes("chinese") ||
      t.includes("japanese") ||
      t.includes("korean") ||
      t.includes("taiwanese") ||
      t.includes("indian")
    ) {
      return "asian";
    }

    if (t.includes("white")) return "white";

    if (
      t.includes("black") ||
      t.includes("african american") ||
      t.includes("african")
    ) {
      return "black";
    }

    if (
      t.includes("native hawaiian") ||
      t.includes("pacific islander")
    ) {
      return "pacificIslander";
    }

    if (
      t.includes("american indian") ||
      t.includes("alaska native")
    ) {
      return "nativeAmerican";
    }

    if (isPreferNotToSay(t)) return "preferNotToSay";

    return null;
  };

  // ── Numeric range / year / month-year readers ───────────────────────

  // Returns the first decimal number found in the string, or null.
  const numberFrom = (text) => {
    const m = String(text || "").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  };

  // Parses ranges like "3.1 - 3.5", "3.1-3.5", "3.5 to 4.0", "below 3.0",
  // "above 3.5", "less than 3.0", "more than 3.5", "<3.0", ">3.5".
  const parseRange = (text) => {
    const t = normalizeText(text);
    if (!t) return null;

    const between = t.match(/(-?\d+(?:\.\d+)?)\s*(?:-|to|and|through|thru)\s*(-?\d+(?:\.\d+)?)/);
    if (between) {
      const a = Number(between[1]);
      const b = Number(between[2]);
      return { min: Math.min(a, b), max: Math.max(a, b), kind: "between" };
    }

    const below = t.match(/(?:below|under|less than|fewer than|<)\s*(-?\d+(?:\.\d+)?)/);
    if (below) {
      return { min: -Infinity, max: Number(below[1]), kind: "below" };
    }

    const above = t.match(/(?:above|over|more than|greater than|>)\s*(-?\d+(?:\.\d+)?)/);
    if (above) {
      return { min: Number(above[1]), max: Infinity, kind: "above" };
    }

    return null;
  };

  // For numeric values like GPA, find the option whose range contains the
  // value. e.g. value=3.5 against options ["below 3.0","3.0 - 3.5","3.5 - 4.0"]
  // → "3.0 - 3.5" (3.5 fits in [3.0, 3.5]). Falls back to nearest range when
  // the value is exactly on a boundary.
  const matchNumericRange = (value, options) => {
    const num = numberFrom(value);
    if (num == null) return null;

    const candidates = options
      .map((option) => ({ option, range: parseRange(option.text) || parseRange(option.value) }))
      .filter((c) => c.range);

    if (!candidates.length) return null;

    // Containing range first.
    const containing = candidates.find(
      (c) => num >= c.range.min && num <= c.range.max
    );
    if (containing) return containing.option;

    // Otherwise pick the nearest by midpoint.
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const lo = Number.isFinite(c.range.min) ? c.range.min : c.range.max;
      const hi = Number.isFinite(c.range.max) ? c.range.max : c.range.min;
      const mid = (lo + hi) / 2;
      const dist = Math.abs(num - mid);
      if (dist < bestDist) {
        best = c.option;
        bestDist = dist;
      }
    }

    return best;
  };

  // Year reading: extract a 4-digit year from any string ("December 2026",
  // "2026", "2026-12-15" → 2026).
  const yearFrom = (text) => {
    const m = String(text || "").match(/\b(19|20)\d{2}\b/);
    return m ? Number(m[0]) : null;
  };

  const monthYearFrom = (text) => {
    const t = normalizeText(text);
    if (!t) return null;

    // ISO month: 2026-12
    const iso = t.match(/^(\d{4})-(\d{1,2})/);
    if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };

    // "December 2026" / "Dec 2026"
    for (const name of Object.keys(MONTH_NAMES)) {
      const re = new RegExp(`\\b${name}\\b\\s+(\\d{4})`);
      const m = t.match(re);
      if (m) return { year: Number(m[1]), month: MONTH_NAMES[name] };
    }

    // "12 2026" / "12/2026"
    const numMonth = t.match(/\b(\d{1,2})[\/\s\-](\d{4})\b/);
    if (numMonth) {
      const month = Number(numMonth[1]);
      if (month >= 1 && month <= 12) {
        return { year: Number(numMonth[2]), month };
      }
    }

    return null;
  };

  // Match a year value (e.g. 2026) against options that may be plain years
  // or contain years inside other text ("December 2026").
  const matchYearOption = (value, options) => {
    const targetYear = yearFrom(value);
    if (targetYear == null) return null;

    return (
      options.find((option) => yearFrom(option.text) === targetYear ||
        yearFrom(option.value) === targetYear) || null
    );
  };

  // Match a "December 2026"-style value against options. We require both
  // year AND month to agree, so the wrong year doesn't sneak in via a
  // partial month match.
  const matchMonthYearOption = (value, options) => {
    const target = monthYearFrom(value);
    if (!target) return null;

    return (
      options.find((option) => {
        const optMonth = monthYearFrom(option.text) || monthYearFrom(option.value);
        return optMonth && optMonth.year === target.year && optMonth.month === target.month;
      }) || null
    );
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

    if (category === "gender" && genderReading(actual) === genderReading(expected) && genderReading(actual) != null) {
      return true;
    }

    if (category === "veteranStatus" && isVeteranNo(actual) && isVeteranNo(expected)) {
      return true;
    }

    if (category === "disabilityStatus" && isDisabilityNo(actual) && isDisabilityNo(expected)) {
      return true;
    }

    if (category === "race" && raceReading(actual) === raceReading(expected) && raceReading(actual) != null) {
      return true;
    }

    return false;
  };

  // Strategy-driven option matcher. Each strategy returns the chosen option
  // or null. We try them in priority order and stop at the first hit.
  const matchOption = (targetValue, options, category = "") => {
    const target = normalizeText(targetValue);
    if (!target || !Array.isArray(options) || options.length === 0) return null;

    const normalizedOptions = options.map((option) => ({
      ...option,
      normalizedText: normalizeText(option.text),
      normalizedValue: normalizeText(option.value),
    }));

    // 1. Exact match on text or value.
    let match = normalizedOptions.find(
      (option) =>
        option.normalizedText === target ||
        option.normalizedValue === target
    );
    if (match) return match;

    // 2. Yes/No / EEO equivalents (uses category-specific readers).
    match = normalizedOptions.find(
      (option) =>
        valuesEquivalent(option.text, targetValue, category) ||
        valuesEquivalent(option.value, targetValue, category)
    );
    if (match) return match;

    // 3. Year-only categories (year fields, graduation year dropdowns).
    //    Try month+year first if both sides have it; fall back to year-only.
    if (
      /year/i.test(category) ||
      /graduation/i.test(category) ||
      monthYearFrom(targetValue)
    ) {
      const monthYearMatch = matchMonthYearOption(targetValue, normalizedOptions);
      if (monthYearMatch) return monthYearMatch;

      const yearMatch = matchYearOption(targetValue, normalizedOptions);
      if (yearMatch) return yearMatch;
    }

    // 4. Numeric range match (GPA buckets, salary bands, years-of-experience).
    if (numberFrom(targetValue) != null) {
      const rangeMatch = matchNumericRange(targetValue, normalizedOptions);
      if (rangeMatch) return rangeMatch;
    }

    // 5. Conservative contains match. Only for longer values to avoid
    //    matching "no" inside unrelated words like "north".
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
    raceReading,
    valuesEquivalent,
    parseRange,
    matchNumericRange,
    yearFrom,
    monthYearFrom,
    matchYearOption,
    matchMonthYearOption,
    matchOption,
  };
})();
