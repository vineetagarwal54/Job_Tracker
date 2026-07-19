function createActiveGenerations() {
  const active = new Map();
  return {
    start(owner) { if (active.has(owner)) return null; const controller = new AbortController(); active.set(owner, controller); return controller; },
    cancel(owner) { const controller = active.get(owner); if (!controller) return false; controller.abort(); return true; },
    finish(owner) { active.delete(owner); },
    has(owner) { return active.has(owner); },
  };
}
module.exports = { createActiveGenerations };
