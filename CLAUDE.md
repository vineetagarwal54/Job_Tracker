# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run electron        # dev: starts Vite (port 5173) and Electron together
npm run dev             # browser-only dev server (Vite alone, no Electron)
npm run build           # production bundle to dist/
npm run electron:build  # full installer in release/ (requires building on the target OS)
```

There is no test runner and no linter wired up.

`vite.config.js` sets `base: "./"` so the built bundle works when loaded by Electron via `file://`. Don't change this without testing the packaged build.

## Architecture

### Two runtimes, one renderer

The same React app runs in two contexts:

1. **Electron** (the real product): `electron/main.cjs` opens a `BrowserWindow` and exposes `window.storage` + `window.electronAPI` via `electron/preload.cjs`.
2. **Plain browser** (`npm run dev`): `src/main.jsx` shims `window.storage` with `localStorage` so the app boots without Electron. `window.electronAPI` is absent and `JobTracker.jsx` no-ops the deep-link listener.

Code that touches storage or deep links must work in both — check for `window.electronAPI` before calling it.

### Single-source-of-truth state

`src/hooks/useJobs.js` owns the **entire** persisted app blob:
`{ workspaces, activeWorkspaceId, jobs, applicationProfiles }`. Despite the name, it manages workspaces, jobs, **and** application profiles. Every mutation flows through one `save()` call that writes the whole blob.

**Don't create a sibling hook that loads/writes the same blob** — two hooks would race and clobber each other's slice. New top-level entities should be added to `useJobs` and exposed alongside the existing CRUD methods.

### Persistence pipeline

```
React component
  └─ useJobs.save({...})
       └─ persistAppData(next)         (src/utils/storageHelpers.js)
            └─ window.storage.set(APP_DATA_KEY, json)
                 └─ ipcRenderer.invoke("storage:set", ...)   (preload.cjs)
                      └─ writeStore(data)                    (electron/main.cjs)
                           └─ atomic write: tmp file + rename
```

Reads mirror this. On read failure, `main.cjs` backs up the corrupt file as `data.json.corrupted-<ts>` and re-throws so the renderer surfaces a load-error banner instead of silently starting fresh.

### Schema migration is centralized

`normalizeAppData` in `src/utils/storageHelpers.js` is the **single migration point**. When adding a new top-level field to the persisted schema, default it there:

```js
function normalizeAppData(data) {
  return {
    workspaces: data.workspaces ?? [],
    ...
    yourNewField: data.yourNewField ?? defaultValue,
  };
}
```

This makes every new field backward-compatible with existing `data.json` files without one-off migration code. The legacy `jobs_v2` → `app_data_v3` upgrade lives next to it for reference.

### Quick Add deep-link flow

The Quick Add bookmarklet builds a `jobtrack://...?company=...&role=...` URL.

- **Electron**: `app.on("open-url")` (mac) and `second-instance` argv parsing (Windows/Linux) hand the URL to `parseDeepLink` → `sendQuickAdd` IPC → renderer's `electronAPI.onQuickAdd` listener. A `pendingDeepLink` slot + `renderer-ready` IPC handshake ensures URLs that arrive before the renderer mounts get flushed once it does.
- **Browser**: `JobTracker.jsx` reads `?quickadd=...` from `window.location.search` on mount.

Both paths converge in `applyQuickAdd`, which prefills the form using a fixed allowlist (`QUICK_ADD_FIELDS`). When extending Quick Add fields, add them to that allowlist or they'll be silently dropped.

### View switching

`JobTracker.jsx` is a top-level shell, not just a job list. `AppTabs` toggles `activeView` between `"jobs"` (the original tracker) and `"profiles"` (`ApplicationProfilesPage`). The Toast and load-error banner stay shared across views; everything else is gated on `activeView`.

### Workspaces

Jobs and workspaces are stored as flat arrays. Each job has a `workspaceId`. There is no nested structure — workspace-scoped ordering operations (`moveJob`, `pinJob`, `moveJobBottom`) work by finding the affected jobs' indices in the flat array and splicing in place. When changing ordering logic, preserve the invariant that reordering inside one workspace must not perturb another's order.

`deleteWorkspace(id, targetWorkspaceId)`: if `targetWorkspaceId` is provided, the workspace's jobs are moved there; otherwise they're deleted with the workspace. The caller (`JobTracker.jsx`'s `DeleteWorkspaceDialog`) is responsible for confirming.

### Application Profiles

Profile shape is intentionally **flat** (no nested objects) because a planned Chrome extension will read profiles verbatim for autofill. Keep it that way when adding fields.

The default-profile invariant: there is always exactly one default if any profiles exist. `addProfile` auto-promotes the first profile; `deleteProfile` promotes the next remaining one when the default is removed; `setDefaultProfile` and `updateProfile` (with `isDefault: true`) demote everyone else.

### Styling

Styles are inline-on-elements + one global stylesheet injected into the DOM via `<style>{globalStyles}</style>` in `JobTracker.jsx` (source: `src/styles.js`). Reusable class names: `.btn`, `.tag`, `.form-input`, `.form-select`, `.filter-select`, `.job-row`, `.action-btn`, `.tab-btn`, `.stat-card`, `.jd-box`. The dark palette (`#0b0b12` background, `#6366f1` accent, Syne for headings, Inter for body) is applied directly in component JSX — there is no theme system or CSS-in-JS framework.

## Releases

Tags trigger `.github/workflows/release.yml`, which builds installers on Windows / macOS / Linux runners in parallel and attaches them to a **draft** GitHub Release. electron-builder cannot cross-compile, hence the per-OS runners. Packaged builds also auto-update via `electron-updater` (see `checkForUpdates` in `electron/main.cjs`).
