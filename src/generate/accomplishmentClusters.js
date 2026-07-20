// Deterministic duplicate-accomplishment prevention (task Phase 4).
//
// The content bank intentionally holds long and shortened versions of the same
// achievement so the model can pick the best fit for the available space. Only
// ONE bullet from each accomplishment may appear in the final resume.
//
// Two layers:
//   1. Explicit `cluster` metadata on overlapping bullets. At most one bullet
//      per cluster id survives.
//   2. A normalized token-overlap fallback for bullets that lack cluster
//      metadata but describe the same accomplishment (e.g. two rewrites that
//      converged). This does not rely on the opening action verb.
//
// The highest-ranked candidate is retained (ranked order is the model's, with
// bank priority as the tie-break upstream). Because every cluster is scoped to
// a single entry, deduplication can never empty a mandatory entry: the
// first-ranked member always survives.

const STOP = new Set(
  "a an and the to of for with in on at from into by using use used across over under this that these those it its our your their as is are was were be been being than then also more most less least up down out off per via not no".split(
    " "
  )
);

// Numbers, metrics and technical compounds carry the accomplishment's identity;
// keep them as tokens rather than stripping punctuation blindly.
export function contentTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#./%-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP.has(token));
}

export function tokenSimilarity(a, b) {
  const setA = new Set(contentTokens(a));
  const setB = new Set(contentTokens(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Removes duplicate accomplishments from an already-ranked bullet list.
// Input items: { section, entry, bullet, text, ... } in ranked order.
// Returns { kept, removed } where removed carries a reason for reporting.
export function dedupeAccomplishments(rankedBullets, options = {}) {
  const similarityThreshold = options.similarityThreshold ?? 0.6;
  const usedClusters = new Set();
  const kept = [];
  const removed = [];

  for (const item of rankedBullets) {
    const cluster = item.bullet?.cluster || null;
    if (cluster) {
      if (usedClusters.has(cluster)) {
        removed.push({
          id: item.bullet.id,
          entryId: item.entry.id,
          section: item.section,
          reason: `duplicate accomplishment cluster '${cluster}'`,
        });
        continue;
      }
      usedClusters.add(cluster);
      kept.push(item);
      continue;
    }
    // Fallback: high token overlap with an already-kept bullet from the same
    // entry indicates the same accomplishment under different wording.
    const near = kept.find(
      (existing) =>
        existing.entry.id === item.entry.id &&
        tokenSimilarity(existing.text, item.text) >= similarityThreshold
    );
    if (near) {
      removed.push({
        id: item.bullet.id,
        entryId: item.entry.id,
        section: item.section,
        reason: `near-duplicate of '${near.bullet.id}' (token overlap)`,
      });
      continue;
    }
    kept.push(item);
  }

  return { kept, removed };
}

// Final verification for a rendered resume: fails when two included bullets
// share a cluster or exceed the similarity threshold. Returns { valid, errors }.
export function verifyNoDuplicateAccomplishments(rankedBullets, options = {}) {
  const similarityThreshold = options.similarityThreshold ?? 0.6;
  const errors = [];
  const seenClusters = new Map();
  for (let i = 0; i < rankedBullets.length; i += 1) {
    const item = rankedBullets[i];
    const cluster = item.bullet?.cluster || null;
    if (cluster) {
      if (seenClusters.has(cluster)) {
        errors.push(
          `duplicate accomplishment cluster '${cluster}' in '${item.bullet.id}' and '${seenClusters.get(cluster)}'`
        );
      } else {
        seenClusters.set(cluster, item.bullet.id);
      }
    }
    for (let j = 0; j < i; j += 1) {
      const other = rankedBullets[j];
      if (other.entry.id !== item.entry.id) continue;
      if (tokenSimilarity(other.text, item.text) >= similarityThreshold) {
        errors.push(
          `near-duplicate accomplishment in '${item.bullet.id}' and '${other.bullet.id}'`
        );
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
