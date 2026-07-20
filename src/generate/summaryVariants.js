// Role-appropriate summary selection (task Phase 7).
//
// The bank carries a verified summary per variant. The renderer picks the one
// matching the selected variant, falling back to the default (ai-llm) text.
// Only verified variants exist in the bank; nothing is invented at runtime.

export function selectSummary(bank, variant) {
  const byVariant = bank?.summary?.byVariant || {};
  return byVariant[variant] || bank?.summary?.text || "";
}
