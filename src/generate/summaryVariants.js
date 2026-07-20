// Role-appropriate summary selection (task Phase 7).
//
// The bank carries a verified summary per variant. The renderer picks the one
// matching the selected variant, falling back to the default (ai-llm) text.
// Only verified variants exist in the bank; nothing is invented at runtime.

// Picks the verified summary for the rendered document. The primary role
// emphasis wins when the bank carries a matching summary (this is what keeps an
// enterprise-AI-builder resume off the inference summary); otherwise it falls
// back to the variant summary, then the default text. Only verified strings
// exist in the bank; nothing is invented at runtime.
export function selectSummary(bank, variant, emphasis = null) {
  const byEmphasis = bank?.summary?.byEmphasis || {};
  const byVariant = bank?.summary?.byVariant || {};
  return (emphasis && byEmphasis[emphasis]) || byVariant[variant] || bank?.summary?.text || "";
}
