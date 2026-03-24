export function isDeadlineSoon(deadline) {
  if (!deadline) return false;
  const d = new Date(deadline);
  const now = new Date();
  const diff = (d - now) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 7;
}

export function isDeadlinePast(deadline) {
  if (!deadline) return false;
  return new Date(deadline) < new Date();
}
