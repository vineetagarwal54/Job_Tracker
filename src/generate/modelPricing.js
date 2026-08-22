// Verified against Anthropic's official pricing documentation on 2026-07-19.
export const PRICING_VERIFIED_DATE = "2026-07-19";
export const MODEL_PRICING_USD_PER_MILLION = Object.freeze({
  analysis: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  writingIntro: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  writingStandard: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
});

export function normalizeUsage(model, usage = {}) {
  const safeUsage = usage && typeof usage === "object" ? usage : {};
  return {
    model,
    inputTokens: Number(safeUsage.input_tokens || 0),
    outputTokens: Number(safeUsage.output_tokens || 0),
    cacheCreationInputTokens: Number(safeUsage.cache_creation_input_tokens || 0),
    cacheReadInputTokens: Number(safeUsage.cache_read_input_tokens || 0),
  };
}

export function estimateUsageCostUsd(usage) {
  if (!usage) return 0;
  const writingTier = Date.now() < Date.parse("2026-09-01T00:00:00Z") ? "writingIntro" : "writingStandard";
  const pricing = MODEL_PRICING_USD_PER_MILLION[String(usage.model).includes("haiku") ? "analysis" : String(usage.model).includes("sonnet") ? writingTier : ""];
  if (!pricing) return 0;
  return Math.round(((usage.inputTokens * pricing.input + usage.outputTokens * pricing.output + usage.cacheCreationInputTokens * pricing.cacheWrite + usage.cacheReadInputTokens * pricing.cacheRead) / 1_000_000) * 1e6) / 1e6;
}

export function estimateGenerationCostUsd(usages) {
  return Math.round(Object.values(usages || {}).reduce((total, usage) => total + estimateUsageCostUsd(usage), 0) * 1e6) / 1e6;
}
