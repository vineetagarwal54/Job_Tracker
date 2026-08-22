# JobTrack

Desktop job-application tracker: Electron + React. Local-only storage, no
backend, no account. Plain JavaScript , no TypeScript anywhere in this repo.

## Existing app conventions

**File layout**
```
electron/
  main.cjs        # main process: window, IPC handlers, deep-link (jobtrack://), auto-update
  preload.cjs      # contextBridge , the ONLY place window.* APIs are exposed to the renderer
src/
  main.jsx         # React entry point
  JobTracker.jsx    # root component, wires all state + layout
  constants.js      # enums, config objects, getEmptyForm() factory, sample data
  styles.js         # global CSS injected via a <style> tag (globalStyles template string)
  components/       # one component per file, PascalCase, .jsx
  hooks/            # useJobs (all state), useFilters, useJobSorting
  utils/            # storageHelpers, validation, deadline, bookmarklet, jobDescriptionCleaner

resume/
  template/          # main.tex , the one-page LaTeX resume template, main.pdf reference render
  output/            # generated .tex/.pdf output , gitignored, not committed
```

**State management** , one hook (`useJobs`) owns the entire app-data blob
(`{ workspaces, activeWorkspaceId, jobs, generationHistory }`) in a single
`useState`. Every mutation goes through `save(updates)`, which does
`{ ...appData, ...updates }` and persists the whole blob atomically via
`persistAppData`. There is no reducer, no context provider, no external state
library , just this one hook returning a big object of state + callbacks,
consumed directly by `JobTracker.jsx`. Follow this pattern for new state
rather than introducing Redux/Zustand/Context.

**Storage IPC pattern** , renderer never touches the filesystem directly.
- `electron/preload.cjs` exposes `window.storage.get(key)` /
  `window.storage.set(key, value)` via `contextBridge`, backed by
  `ipcRenderer.invoke("storage:get"/"storage:set", ...)`.
- `electron/main.cjs` registers `ipcMain.handle("storage:get"/"storage:set", ...)`
  reading/writing a single JSON file at `app.getPath("userData")/data.json`,
  with atomic writes (write to `.tmp`, then `renameSync`) and corrupted-file
  backup-and-rethrow on parse failure.
- `contextIsolation: true`, `nodeIntegration: false` , always. Any new native
  capability (e.g. calling the Anthropic API, running `tectonic`) must be
  implemented as a new `ipcMain.handle` in main.cjs and exposed narrowly via
  preload.cjs, never by relaxing contextIsolation or exposing `require`.
- `src/utils/storageHelpers.js` wraps `window.storage` with JSON
  serialize/deserialize, defaulting, and legacy-data migration. New
  persisted shapes should follow the same normalize-on-load pattern
  (`normalizeAppData`-style defaults) rather than one-off migrations.

**Styling** , inline `style={{...}}` objects on JSX elements for
one-off/component-specific styling, plus a handful of reusable classes
(`.btn`, `.form-input`, `.form-select`, `.filter-select`, `.tag`, `.tab-btn`,
`.jd-box`, `.stat-card`) defined once in `src/styles.js` and injected as a
global `<style>` tag in `JobTracker.jsx`. Dark theme only: background
`#0b0b12`/`#0e0e18`/`#12121c`, borders `#1a1a2e`/`#222233`, body text
`#e2e8f0`, muted text `#94a3b8`/`#5a6070`, indigo accent `#6366f1`/`#a5b4fc`,
error red `#f87171`/`#2d1010`, success green `#4ade80`. Font: Inter (body),
Syne (headings/titles), loaded via Google Fonts `@import` in `styles.js`.
Modals are `position: fixed; inset: 0` overlays with `backdropFilter: blur(6px)`.

**Forms** , controlled `useState(initialForm)` + a local `errors` object from
a `validate*Form()` function in `src/utils/validation.js`; errors clear
per-field on edit. See `JobForm.jsx`.

**No dependencies beyond**: react, react-dom, electron-updater
(runtime); vite, @vitejs/plugin-react, electron, electron-builder,
concurrently, wait-on (dev). Do not add a package without asking first ,
this applies doubly to the resume feature (no LaTeX npm wrapper, no
markdown-to-tex lib, no state-management lib, no HTTP client beyond
built-in `fetch`).

---

## AI Resume Generation feature

**What it does**: user clicks Generate on a captured job. The app produces a
tailored one-page LaTeX resume in the existing template
(`resume/template/main.tex`), an ATS coverage report, and optionally a cover
letter.

### Architecture decision that matters most

**The LLM never writes the resume document.** The selected job option chooses
one of three canonical bases. The model may propose only a small structured
diff referencing canonical, base, and content-bank IDs. Deterministic JS
validates and applies that diff, then renders it into the LaTeX template. This prevents template
drift (LLM inventing new LaTeX structure/sections) and invented metrics
(LLM fabricating numbers that aren't in the source bullets). Any
implementation that lets the model emit raw `.tex` or free-form prose that
gets inserted verbatim into the document is wrong. The model's only resume
output is a bounded structured diff; JS owns every byte
of the `.tex` file.

### Pipeline

1. **Deterministic keyword extraction** from the job description , no API
   call. Plain JS/regex/tokenization against the JD text.
2. **Haiku call** (`claude-haiku-4-5-20251001`) , classify role family,
   seniority, must-have requirements, blockers (e.g. citizenship/clearance
   requirements the user can't meet). Cheap, fast, small output.
3. **Deterministic coverage score** of the selected canonical base against the
   extracted JD keywords , no API call. Surfaces gaps before spending a
   Sonnet call.
4. **Sonnet call** (`claude-sonnet-5`), **streamed**, with the content bank
   as a **cached** stable prefix (prompt caching), returns only a bounded
   tailoring diff chosen from deterministic minimum-benefit candidates.
5. **Deterministic render**: JSON → `.tex`, using the measured spacing
   constants below. Pure JS, no API.
6. **Compile** `.tex` → PDF via `tectonic` (shelled out from the main
   process).
7. **Compile-driven one-page backoff and post-render ATS check** on the final
   rendered document. Overflow reverts the least valuable accepted changes;
   it never trims original base content.

Only steps 2 and 4 call the API. Steps 1, 3, 5, 7 are pure deterministic JS
and must stay that way , do not fold them into a prompt "for simplicity."

Cover letters use the final post-backoff resume and existing job analysis.
They use one streamed Sonnet writing call followed by deterministic factual
validation, render, compile, and one-page verification. The humanizer pass is
retired. Invalid prose or model failure uses the conservative verified fallback
without another model call.

### Measured constants (from the actual template , do not re-derive)

Re-measured 2026-07-19 after the font switch to XCharter (previous 113/12pt
baseline was measured under the old font and is stale). Method: compile with
tectonic, cross-checked with both `pdfplumber` and `pypdf` text extraction ,
they agree exactly on the longest wrapped-bullet line. Note: `pdfplumber`'s
raw per-character join (`page.chars`) drops spaces on tightly kerned lines;
use `page.extract_text(x_tolerance=1.5, y_tolerance=3)` instead, which
matched `pypdf`'s `extract_text(extraction_mode="layout")` byte-for-byte.

- **119 characters per bullet line** (longest wrapped first line, bullet
  marker and its trailing space excluded , the marker sits in the
  `leftmargin` gutter, not the wrapped-text column)
- **11.96pt line pitch** (median and mode agree; single dominant gap across
  all Experience/Projects body lines)
- Template fits one page with a freshly measured free space of approximately 3.15 lines (37.71pt) after the Runara correction
- **Fixed overhead: ~27 lines (321.51pt)** , header/contact block, summary,
  Skills section (header + both columns), and the Education section
  (header + entry) plus the Experience and Projects section header lines
  themselves. This does **not** include Experience/Projects heading lines
  (org/role/dates) or bullets , those scale with content and are excluded
  from "fixed" overhead by definition.
- Compiles under both **XeTeX (tectonic)** and **pdfLaTeX (Overleaf)** , any
  template or rendering change must preserve both. The template's own
  header comment documents this constraint and consolidates spacing dials
  at the top of `main.tex` (`\sectionBefore`, `\sectionAfter`, `\listTopSep`,
  `\listBottomTrim`, `\headerRuleGap`, `\skillRowSep`) for one-place tuning ,
  use those instead of hand-editing spacing throughout the file. The
  `main.tex` spacing-dial comment is updated to the 119-character,
  11.96pt measurement.

### Stack constraints

- Electron 33, React 18, Vite 5, **plain JavaScript, no TypeScript**
- API calls happen **only in the Electron main process**, never the
  renderer , same contextIsolation boundary as storage IPC. New
  `electron/anthropic/` module holds this; renderer talks to it through a
  narrowly-scoped preload bridge + `ipcMain.handle`, same shape as
  `storage:get`/`storage:set`.
- API key stored via **Electron `safeStorage`**, explicitly **not**
  `electron-store` (the app doesn't use electron-store anywhere , storage
  is the hand-rolled JSON-file IPC pattern above, and the key needs OS
  keychain-backed encryption, which plain JSON-on-disk doesn't give you).
- Models: `claude-haiku-4-5-20251001` for analysis (step 2),
  `claude-sonnet-5` for generation (step 4).
- Prompt caching on the content bank as the stable prefix for the Sonnet
  call.
- Streaming is mandatory for the Sonnet call.
- **No new npm dependencies without asking first** , includes the Anthropic
  SDK itself; confirm before adding `@anthropic-ai/sdk` vs. hand-rolled
  `fetch` against the Messages API.

### Writing rules for any resume or cover letter content this system produces

- No em dashes, and no hyphens used as separators
- Every action verb unique across all bullets in one document
- Never invent a number; use bracketed placeholders (e.g. `[X%]`, `[N
  users]`) for unknowns instead of fabricating a metric
- Never weaken an existing metric (a rewrite may rephrase around a number
  but must not round it down, hedge it, or drop it)

### New directories for this feature

- `resume/template/` , `main.tex` (template), `main.pdf` (reference render)
- `resume/output/` , generated `.tex`/`.pdf` per job, **gitignored**
- `src/generate/` , renderer-side: content bank JSON, keyword extraction,
  coverage scoring, JSON→LaTeX rendering, ATS check (steps 1, 3, 5, 7 ,
  all deterministic, no API calls belong here)
- `electron/anthropic/` , main-process-side: Anthropic API client, Haiku
  analysis call (step 2), Sonnet generation call (step 4), safeStorage key
  handling, tectonic invocation (step 6)
