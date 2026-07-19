# JobTrack AI Resume Generation — Complete Project Context

**Owner:** Vineet Agarwal
**Repo:** github.com/vineetagarwal54/Job_Tracker (local: `D:\Projects\JobTrack`)
**Document date:** July 19, 2026 (rev 2)
**Target completion:** August 15, 2026
**Status:** Phase 0 complete. Template constants re-measured. The CUDA conflict is resolved and the template correction is applied.

**Place this file at the repo root and commit it.** Tooling has been instructed to read it by path.

---

## 0. How to use this document

This is a complete handoff. If you are an LLM or a person picking this up cold, read Sections 1 through 5 to understand what is being built and why, then Section 12 for where the work currently stands.

The single most important thing to internalize is **Section 4**. If you get that wrong, everything downstream is wrong.

Two things to be careful about:

- Section 7's constants are current as of the XCharter render, but the **free space figure changes once the Runara correction in Section 15 is applied**, because that entry gains a third bullet. Re-measure after applying it.
- Section 15 documents a **resolved factual conflict**. The resolution is authoritative. The correction may not yet be applied to `main.tex`; check before assuming.

---

## 1. What is being built

An **AI Resume Generation** feature inside JobTrack, an existing Electron plus React desktop job application tracker.

The user captures a job posting via an existing browser bookmarklet. The job, including its full description text, lands in the tracker. The user then clicks **Generate** on that job, and the app produces:

1. A tailored **one page LaTeX resume** rendered in the user's existing template, exported as PDF
2. An **ATS coverage report** showing which job description keywords the resume does and does not cover
3. Optionally, a **cover letter**, also LaTeX to PDF

Everything runs locally. The only network calls are to the Anthropic API. There is no backend, no account, and no telemetry.

### Why it exists

The owner's job search bottleneck is a resume to online assessment conversion problem, historically 2 to 3 percent against a target of 8 to 12 percent. Tailoring each application helps, but the manual loop costs 5 to 8 minutes per application in context switching: find job in tracker, open Claude, paste job description, wait, copy output, return to tracker, log it. That friction means tailoring gets skipped when tired.

Embedding generation into the tracker collapses the loop to: job is already in the tracker, click Generate, review, export. The activation energy drops to near zero, so more applications actually get tailored.

Full time application season ramps in September 2026. The tool needs to exist before then or it is not worth building.

---

## 2. The person and their constraints

Facts that shape design decisions:

- Master of Engineering, Computer Software Engineering, University of Maryland College Park. January 2025 to December 2026. Cloud Engineering minor. GPA 3.7.
- Roughly 2 years of prior industry experience before grad school.
- Targeting AI infrastructure, LLM serving, and cloud native backend roles at tier one companies, plus financial sector engineering teams.
- International student. Internships via CPT, full time via OPT with STEM extension. "No sponsorship" is **not** a hard blocker for full time roles. Only citizenship requirements, security clearance requirements, or explicit OPT and CPT rejection are blockers.
- Maintains **four resume variants**, not one. The tool must respect this.
- Windows machine, PowerShell.

### Writing rules, non negotiable

These apply to all generated resume and cover letter content:

- **No em dashes.** No hyphens used as separators or pauses.
  - ATS exception: standard hyphenated technical terms (`full-stack`, `end-to-end`, `CI/CD`, `TensorRT-LLM`, `4-bit`) keep conventional spelling inside skills lists and keyword contexts, because removing the hyphen hurts keyword matching.
- **Every action verb unique** across all bullets in a single document.
- **Never invent a number.** Use bracketed placeholders (`[X%]`, `[N users]`) for unknowns.
- **Never weaken an existing metric.** A rewrite may rephrase around a number but must not round it down, hedge it, or drop it.
- No AI sounding filler. Direct, personal voice.

---

## 3. The existing app

### Stack

Electron 33, React 18, Vite 5. **Plain JavaScript, no TypeScript anywhere.**

Runtime dependencies: `react`, `react-dom`, `electron-updater`.
Dev dependencies: `vite`, `@vitejs/plugin-react`, `electron`, `electron-builder`, `concurrently`, `wait-on`.

**Adding a dependency requires explicit approval.** This includes the Anthropic SDK. Default position is hand rolled `fetch` against the Messages API rather than `@anthropic-ai/sdk`.

### File layout

```
electron/
  main.cjs         main process: window, IPC handlers, jobtrack:// deep link, auto-update
  preload.cjs      contextBridge, the ONLY place window.* APIs reach the renderer
  anthropic/       NEW: API client, Haiku call, Sonnet call, safeStorage, tectonic
src/
  main.jsx         React entry
  JobTracker.jsx   root component, wires all state and layout
  constants.js     enums, config objects, getEmptyForm(), getEmptyProfile(), sample data
  styles.js        global CSS as a template string, injected via <style>
  components/      one component per file, PascalCase, .jsx
  hooks/           useJobs (all state), useFilters, useJobSorting
  utils/           storageHelpers, validation, deadline, bookmarklet, jobDescriptionCleaner
  generate/        NEW: content bank, keyword extraction, coverage scoring, LaTeX render, ATS check
extension/         separate browser extension for autofill, unrelated to this feature
resume/
  template/        main.tex, main.pdf reference render
  output/          generated .tex and .pdf, gitignored
```

### Conventions that must be followed

**State management.** One hook, `useJobs`, owns the entire app data blob:
```js
{ workspaces, activeWorkspaceId, jobs, applicationProfiles }
```
in a single `useState`. Every mutation goes through `save(updates)`, which does `{ ...appData, ...updates }` and persists the whole blob atomically via `persistAppData`.

No reducer, no context provider, no external state library. New state follows this pattern. Do not introduce Redux, Zustand, or Context.

**Storage IPC.** The renderer never touches the filesystem.

- `preload.cjs` exposes `window.storage.get(key)` and `window.storage.set(key, value)` via `contextBridge`, backed by `ipcRenderer.invoke`.
- `main.cjs` registers `ipcMain.handle("storage:get")` and `ipcMain.handle("storage:set")`, reading and writing a single JSON file at `app.getPath("userData")/data.json`, with atomic writes (write to `.tmp`, then `renameSync`) and corrupted file backup on parse failure.
- `contextIsolation: true`, `nodeIntegration: false`, **always**.
- Any new native capability, including calling the Anthropic API and running `tectonic`, must be a new `ipcMain.handle` exposed narrowly via preload. **Never relax contextIsolation. Never expose `require`.**
- `src/utils/storageHelpers.js` wraps `window.storage` with JSON serialization, defaulting, and legacy migration. New persisted shapes follow the same normalize on load pattern.

**Styling.** Inline `style={{...}}` objects plus a handful of shared classes (`.btn`, `.form-input`, `.form-select`, `.filter-select`, `.tag`, `.tab-btn`, `.jd-box`, `.stat-card`) defined once in `styles.js`.

Dark theme only:
- Backgrounds `#0b0b12`, `#0e0e18`, `#12121c`
- Borders `#1a1a2e`, `#222233`
- Body text `#e2e8f0`, muted `#94a3b8`, `#5a6070`
- Indigo accent `#6366f1`, `#a5b4fc`
- Error `#f87171` on `#2d1010`, success `#4ade80`
- Fonts: Inter for body, Syne for headings, via Google Fonts `@import`
- Modals are `position: fixed; inset: 0` with `backdropFilter: blur(6px)`

**Forms.** Controlled `useState(initialForm)` plus a local `errors` object from a `validate*Form()` function in `src/utils/validation.js`. Errors clear per field on edit.

---

## 4. The core architecture decision

**The LLM never writes the resume document.**

The model selects and lightly rewrites bullets from a fixed, hand maintained content bank (JSON). Deterministic JavaScript renders those selections into the LaTeX template.

### Why this matters

Three failure modes this prevents:

1. **Template drift.** If the model emits LaTeX, it will invent sections, change spacing, and produce a slightly different document every run. The template stops being *your* template.
2. **Invented metrics.** A model writing bullets from scratch will fabricate numbers. Since the bank contains only real, verified bullets, there is nothing to fabricate from.
3. **Silent one page violations.** If the model controls the document, page length is unpredictable. If JS controls it, page length is arithmetic.

### The rule, stated as a test

> The model's only output is structured JSON referencing or rewriting bank entries. JavaScript owns every byte of the `.tex` file.

**Any implementation where the model emits raw `.tex`, or where free form prose is inserted verbatim into the document, is wrong.** This is the most common way an implementer will "simplify" this design and break it.

### The one page solution

Do not use a compile, check, shrink, recompile loop. Compute a budget before the model runs.

1. Measure the template once: fixed overhead in lines, remaining bullet line budget, characters per line.
2. **Ask the model for more bullets than there are slots**, ranked by relevance. Request 18 when there are 14 slots.
3. The renderer fills slots top down using `ceil(chars / charsPerLine)`, and stops at budget.
4. Overflow costs nothing because it required no extra API call.

Optionally add a verification compile that reads the actual page count from the PDF and trims one more bullet if the heuristic was off. Cheap, no API call.

---

## 5. The pipeline

Seven steps. **Only steps 2 and 4 call the API.** Steps 1, 3, 5, 6, and 7 are deterministic and must stay that way. Do not fold them into a prompt for simplicity.

```
Bookmarklet captures job  →  JD stored in tracker
              ↓
        User clicks Generate
              ↓
  [1] DETERMINISTIC  Keyword extraction from JD
      Plain JS tokenization, normalization, dedupe. No API.
              ↓
  [2] API, HAIKU     JD analysis
      claude-haiku-4-5-20251001
      Returns: role family, seniority, must-have vs nice-to-have,
      blockers (citizenship, clearance), recommended variant.
      Small output, cheap, fast.
              ↓
  [3] DETERMINISTIC  Coverage score
      Content bank tags vs extracted JD keywords. No API.
      Surfaces gaps BEFORE spending a Sonnet call.
              ↓
  [4] API, SONNET    Bullet selection and rewrite
      claude-sonnet-5, STREAMED, content bank as CACHED prefix.
      Returns structured JSON. Must return MORE ranked bullets
      than there are template slots.
              ↓
  [5] DETERMINISTIC  Render
      JSON → .tex using measured constants. Pure function. No API.
              ↓
  [6] DETERMINISTIC  Compile
      tectonic shelled out from the Electron main process. .tex → PDF
              ↓
  [7] DETERMINISTIC  Post-render ATS check
      Keyword coverage of the FINAL document, page count, parse
      safety, verb repetition. No API.
      Checks what actually shipped, not what was requested.
              ↓
  Export: .tex, .pdf
              ↓
  [8] OPTIONAL, SONNET  Cover letter
      Cache hit on the content bank, so very cheap.
```

### Why the split matters

Step 3 exists so a bad match is caught for a fraction of a cent instead of three cents. Step 7 exists because what the model was asked to produce and what the renderer actually shipped can differ, and only the shipped document matters.

---

## 6. Model and API configuration

| Purpose | Model | Notes |
|---|---|---|
| JD analysis (step 2) | `claude-haiku-4-5-20251001` | Non streamed, small output, JSON |
| Generation (step 4) | `claude-sonnet-5` | Streamed, prompt caching on content bank |
| Cover letter (step 8) | `claude-sonnet-5` | Cache hit |

**Never Opus.** It is overkill for document generation and multiplies cost with no quality gain on this task.

### Hard requirements

- **API calls only from the Electron main process.** Never the renderer. Same contextIsolation boundary as storage.
- **Streaming is mandatory** for the Sonnet call. Generation takes 10 to 15 seconds. Without streaming the user sees a blank screen and assumes it is broken. With streaming, text appears in 1 to 2 seconds.
- **API key via Electron `safeStorage`**, explicitly not `electron-store`.
  - Rationale: `safeStorage` encrypts against the real OS keychain (Keychain on Mac, DPAPI on Windows, libsecret on Linux). `electron-store` encryption uses a passphrase compiled into the bundle, which is not meaningfully secret. `safeStorage` also adds zero dependencies.
  - Degradation: on Linux desktops without a keyring, `safeStorage.isEncryptionAvailable()` returns false. Fall back to plaintext with a visible warning. Not a concern on Windows or Mac.
- **Prompt caching** with the content bank as the stable prefix. Cache write costs 1.25x base input, cache reads cost 10 percent of base input. Default TTL is 5 minutes, which covers one application session.
- **Cancellation** via `AbortController`, surfaced to the UI.

---

## 7. Measured constants

Measured against the current **XCharter** render on July 19, 2026. The earlier figures (113 chars, 12pt) were taken while the font had silently fallen back to Latin Modern and are void.

| Constant | Value | Notes |
|---|---|---|
| Characters per bullet line | **119** | XCharter is slightly narrower than Latin Modern |
| Line pitch | **11.96pt** | Median equals mode, so this is a clean grid |
| Free space at page bottom | **5.15 lines (61.63pt)** | **Stale once the Runara fix lands.** See below. |
| Fixed overhead | **~27 lines (321.51pt)** | See definition below |
| Text width | 553.7pt (7.69in) | Set by geometry, font independent |
| Page size | 612 x 792pt (US Letter) | |

### Bullet line arithmetic

| Lines consumed | Max characters |
|---|---|
| 1 | 119 |
| 2 | 238 |
| 3 | 357 |

The renderer computes `ceil(chars / 119)` per bullet, accumulates, and stops at budget.

### Fixed overhead, defined precisely

Fixed overhead is everything that does **not** scale with bullet selection:

- Header and contact block
- Summary
- The entire Skills block, both minipages
- The Education section
- The four `\section` header lines themselves

**Excluded**, because they scale with content: org, role, and date lines (`\headingBf`, `\headingIt`), and all bullets.

This separation is what makes the budget computable. Fixed overhead is constant across every generated resume, so:

```
variableLineBudget = currentVariableLines + freeLines
```

Have the measurement script emit `currentVariableLines` directly rather than deriving `usableHeight` in the abstract.

### Pending re-measure

The Section 15 correction replaces two Runara bullets with three, consuming roughly 1 of the 5.15 free lines. **Re-measure after applying it** and update this section plus `CLAUDE.md`, `AGENTS.md`, and the `main.tex` header comment.

### How to measure

Compile with tectonic, then read the PDF with Python and report page count, characters in the first line of the longest wrapped bullet, median line pitch from gaps between consecutive baseline `top` values, y position of the last baseline, free space in pt and whole lines, and the fixed overhead as defined above.

Cross check with **both** `pdfplumber` and `pypdf`. `pdfplumber`'s word splitter misreads tightly kerned lines and will report missing spaces that are actually present in the text layer.

## 8. The LaTeX template

`resume/template/main.tex`. Based on MTecknology's resume template, CC-BY-4, modified.

**Single self contained file. No `.cls` or `.sty` dependencies.** All packages are standard CTAN.

### Compiles under both engines

The template must keep working under **XeTeX** (via tectonic, locally) and **pdfLaTeX** (via Overleaf, where it is authored). Any change must preserve both.

### Two pdfTeX incompatibilities already fixed

These are documented because the same class of bug will recur if the template is edited:

1. **`\pdfglyphtounicode`** is a pdfTeX primitive that XeTeX lacks. Guarded:
   ```latex
   \ifdefined\pdfglyphtounicode
     \input{glyphtounicode}
     \pdfgentounicode=1
   \fi
   ```
   Nothing is lost under XeTeX, which embeds Unicode mapping natively with OpenType fonts.

2. **`px` is not a standard LaTeX unit.** pdfTeX supports it via `\pdfpxdimen`; XeTeX does not. `itemsep=0px` was changed to `itemsep=0pt`. Identical output, compiles everywhere.

### Font gotcha, already fixed

`\usepackage{charter}` under XeTeX silently fell back to Latin Modern **with no bold and no italic anywhere in the document**. Every `\textbf` and `\textit` rendered as regular. The cause was that removing `CormorantGaramond` also removed the thing that was loading `fontspec`.

Fixed by switching to **`\usepackage{XCharter}`**, the modern OpenType successor, which carries proper bold and italic and works under both engines.

**Diagnostic worth knowing:** if the resume looks visually flat, dump the font inventory from the PDF. If every glyph is one Regular face, bold is not rendering.

### Spacing dials

Consolidated at the top of `main.tex` for one place tuning. Use these rather than hand editing spacing throughout the file.

```latex
\sectionBefore    7pt    % space above each \section
\sectionAfter     6pt    % space below the section rule
\listTopSep       0pt    % space above first bullet in a list
\listBottomTrim  -3pt    % negative space after a bullet list
\headerRuleGap    6pt    % gap between name and the accent rule
\skillRowSep      1pt    % between skill rows in the minipages
```

Baseline before tuning wasted roughly 136pt (about 11 lines) in default `\section` spacing that the original template never set via `\titlespacing*`.

### Structure

Macros the renderer must emit into:

- `\documentTitle{name}{contact block}`
- `\tinysection{Summary}` followed by prose
- `\section{...}` for Skills, Experience, Education, Projects
- `\headingBf{org}{dates}` and `\headingIt{role}{}` for each entry
- `\begin{resume_list} \item ... \end{resume_list}` for bullets
- Skills use two `minipage[t]{0.48\textwidth}` blocks side by side

### LaTeX escaping

The renderer must escape `& % $ # _ { } ~ ^ \` in all injected content. The one that will actually bite is `&` in strings like "R&D" or "Ford & Co", and `%` in "reduced 40%".

Also wrap keywords that must not break across lines: `\mbox{TensorRT-LLM}`. A hyphenated term split across a line break can be rejoined by parsers as `TensorRTLLM`, losing the keyword.

---

## 9. Content bank schema

`src/generate/content-bank.json`. **Hand maintained source of truth. Not generated at runtime. The LLM never writes to it.**

```json
{
  "meta": { "version": 1, "updated": "YYYY-MM-DD" },
  "identity": {
    "name": "", "location": "", "phone": "", "email": "",
    "links": { "linkedin": "", "github": "", "portfolio": "" }
  },
  "education": [
    { "id": "", "school": "", "degree": "", "dates": "", "gpa": "", "note": "" }
  ],
  "skillGroups": [
    { "id": "", "label": "", "items": [], "variants": [] }
  ],
  "experience": [
    {
      "id": "", "org": "", "role": "", "dates": "", "location": "",
      "variants": [],
      "bullets": [
        {
          "id": "",
          "text": "",           // exact current wording
          "chars": 0,            // COMPUTED length of text, never estimated
          "skills": [],          // normalized lowercase tags for coverage scoring
          "variants": [],        // which resume bases this belongs to
          "lockedMetrics": [],   // substrings that MUST survive any rewrite
          "priority": 1,         // 1 = strongest, higher = weaker
          "rewritable": true     // false = render verbatim, no rewriting
        }
      ]
    }
  ],
  "projects": [ /* same shape as experience, plus a "link" field */ ],
  "doNotClaim": []               // guard rail, things not done
}
```

### Field rationale

- **`chars` computed, not estimated.** This is what makes the line budget arithmetic trustworthy. Estimating here silently breaks one page enforcement.
- **`lockedMetrics`** stops a rewrite turning "7.5e-6 at fp32" into "high numerical accuracy".
- **`rewritable: false`** for bullets where precise wording carries technical weight.
- **`priority`** gives the model a starting rank so it is reordering rather than ranking from scratch.
- **`doNotClaim`** is the guard rail against the model reaching for adjacent but false claims.

### Variant ids

Exactly these, used consistently across the bank and all tooling:

| id | Meaning |
|---|---|
| `ai-llm` | AI and LLM systems. **Primary variant.** |
| `cloud-backend` | Cloud, platform, and backend |
| `fullstack` | Full stack and product engineering. Doubles as forward deployed engineer. |
| `mobile` | React Native and mobile. Deploy only for explicitly mobile listings. |
| `academic` | Teaching, research, program roles. Rarely used. |

### Sizing

Target **30 to 40 experience bullets and 8 to 12 project bullets**, against a template that holds roughly 14 bullet slots.

The bank must be substantially larger than the page. **The selection problem only has value if there is something to select from.** A bank the same size as the resume makes the whole system pointless.

Populate `ai-llm` fully first. Tag other variants where obvious but do not force it.

---

## 10. Cost model

Pricing as of July 2026:

| Model | Input | Output | Cached read |
|---|---|---|---|
| Claude Haiku 4.5 | $1.00 / MTok | $5.00 / MTok | $0.10 / MTok |
| Claude Sonnet 5 | $2.00 / MTok (intro, through Aug 31) | $10.00 / MTok | $0.20 / MTok |
| Claude Sonnet 5 | $3.00 / MTok (from Sept 1) | $15.00 / MTok | $0.30 / MTok |

Prompt caching cuts cached input by 90 percent. Cache writes cost 1.25x base input. Batch API halves everything but is not applicable here since this is interactive.

### Per application, warm cache

| Step | Model | Cost |
|---|---|---|
| JD analysis | Haiku | $0.011 |
| Bullet selection and rewrite | Sonnet | $0.026 |
| Cover letter | Sonnet, cache hit | $0.008 |
| **Total** | | **~$0.045** |

### Season projection

200 applications: roughly $9. With regeneration on half of them, roughly $14. After September 1 when intro pricing ends, add about 40 percent.

**Budget $15 to $20 for the entire fall cycle.** A $10 prepaid credit covers most of it.

### What would blow this up

- Routing generation to Opus
- Failing to cache the content bank, which is roughly 8k tokens on every call
- Retry loops for one page fitting, which the ranked overflow design eliminates

---

## 11. Tooling decisions

Decisions made deliberately, with reasoning, so they are not relitigated.

### Claude Code and Codex, split by task type

**The rule:** anything touching resume **content** goes to Claude Code, because that is where the personal context skills live. Anything that is **pure deterministic code** goes to Codex, which is roughly 4x more token efficient and strong on well scoped tasks.

| Phase | Tool | Why |
|---|---|---|
| 0. Repo prep | Claude Code | Needs repo comprehension |
| 1. Content bank | **Claude Code only** | Personal facts. Codex will invent metrics. |
| 2. Renderer | Codex | Pure function, clear contract, testable |
| 3. API client | Claude Code | Codex may hallucinate Anthropic API shapes |
| 4a. Keyword scorer | Codex | Deterministic JS |
| 4b. Analysis prompt | Claude Code | Prompt engineering |
| 5. Generation | Claude Code | Prompt, caching, writing rules |
| 6. UI | Codex scaffold, Claude Code polish | Design skills live in Claude |
| 7. Cover letter | Claude Code | Humanizer skill |

**Do not loop the two tools on every task.** Alternating doubles time and burns context re-explaining. Use one tool per phase. Bring in the second only for review on the phases where a mistake is expensive:

- **Codex reviews Phase 3** (key storage, AbortController cleanup)
- **Claude Code reviews Phase 2** (escaping against real JD text)

**Both tools need a context file or they drift.** Claude Code reads `CLAUDE.md`, Codex reads `AGENTS.md`. These are maintained as near identical twins. Drift between them is the main failure mode of a dual agent setup.

### Which skills to install, and which to only read

The personal context skills live in claude.ai (the web app) at `/mnt/skills/user/` and are **not on disk**. Claude Code reads `~/.claude/skills/` (global) and `.claude/skills/` (project scoped). Prefer **project scoped**, so the context travels with the repo and stays out of unrelated projects:

```
D:\Projects\JobTrack\.claude\skills\vineet-resume-context\SKILL.md
```

| Skill | When |
|---|---|
| `vineet-resume-context` | **Install now.** Phase 1 depends on it. |
| `humanizer`, `cover-letter-generator` | Install at Phase 7 |
| `resume-tailor`, `tech-resume-optimizer`, `resume-bullet-writer`, `resume-quantifier`, `job-description-analyzer` | **Read, do not install** |
| `interview-prep-generator`, `linkedin-profile-optimizer` | Never in this repo |

**Why not install the resume skills.** They encode the manual workflow this app is replacing, which makes their selection logic and scoring heuristics valuable as *specification input* for Phases 4 and 5, and actively harmful as *installed skills*.

Two concrete risks:

- **Misfire.** `resume-tailor` triggers on "tailor my resume" and on pasted job descriptions. Phase 5 involves writing prompts containing job descriptions and the word "tailor." If it fires, it will try to rewrite the resume directly, which is exactly what the Section 4 architecture rule forbids.
- **Context cost.** Every installed skill's name and description sits in context from session start, on phases that have nothing to do with resume writing.

Correct approach at Phase 4: have the agent read `job-description-analyzer` and `resume-quantifier` **as reference documents**, extract their scoring and selection logic, and encode it into the deterministic scorer and the prompts. Capture the thinking without the trigger surface.

### `/ultraplan`: yes, after Phase 1

Cloud plan mode against a connected GitHub repo, reviewed in the browser with inline comments before implementation. Right fit for planning Phases 2 through 6.

**Run it after Phase 1, not before.** It plans against the real repo, so it needs `content-bank.json` and the template to exist. Running it earlier means planning against assumptions, which is what it exists to prevent.

### `/powerup`: not for this build

In terminal interactive tutorials on hooks, MCP, subagents, context management. Useful generally, irrelevant here.

### `/insights`: after, not during

Reads the last 30 days of session transcripts and reports friction patterns to a local HTML report. Run once the build is done and there is data. Running it now on sparse data yields nothing.

### GitHub Spec Kit: no

Genuinely good and currently dominant, but tuned for greenfield multi file builds where the spec is source of truth from line zero. This is a brownfield addition to a working app with established patterns. It also adds 20 to 40 percent API spend because the agent rereads spec, plan, and tasks every turn. `/ultraplan` delivers most of the benefit without the framework overhead.

### Graphify: no

Knowledge graph tooling that replaces file reading with graph queries. Their own benchmark table is the reason to skip it:

| Corpus | Files | Reduction |
|---|---|---|
| Karpathy repos + papers + images | 52 | 71.5x |
| graphify source + Transformer paper | 4 | 5.4x |
| httpx synthetic library | 6 | **~1x** |

JobTrack has roughly 7 to 20 source files. That is the bottom row. There is also an open issue from a Claude Code user reporting Graphify *increased* token usage at small repo sizes, because the agent announces it will read the graph, reads the graph report, and still reads the files.

**A curated `CLAUDE.md` beats a generated graph at this scale.**

### MCP layer: no

MCP exists so agents can reach external services. The Electron app calls the Anthropic API directly over HTTPS from the main process. Inserting MCP adds a protocol layer, a server process, and a failure mode, in exchange for nothing.

The interesting inverse, exposing JobTrack *as* an MCP server so Claude Code can query application history, is a nice thing to have later, not a dependency for shipping.

### DOCX export: dropped

Originally planned. Dropped because:

- PDF is correctly parsed by Workday, Greenhouse, Lever, and Ashby in 2026. The "PDF breaks ATS" advice is roughly a decade stale.
- Converting LaTeX to DOCX via pandoc works on generic LaTeX but destroys custom resume classes with their own spacing macros and `\titleformat` rules.
- A second independent DOCX renderer is 6 to 8 hours of work for a fallback that may never be used.

If a portal ever rejects the PDF, build it then as a **second renderer from the same content JSON**, not as a conversion of the `.tex`.

---

## 12. Build phases and status

```
PHASE 0  Repo prep              CLAUDE.md, AGENTS.md, folders      Claude Code   DONE
   │
   ▼
PHASE 1  Content bank           content-bank.json                  Claude Code   IN PROGRESS
   │                            Constants re-measured DONE
   │                            main.tex CUDA correction APPLIED
   │                            Bank population PENDING
   ▼
        ◄── /ultraplan here ──►  Plan Phases 2 to 6 against real data
   ▼
PHASE 2  Renderer               JSON → .tex → PDF                  Codex
   ▼
PHASE 3  API client             Streaming, safeStorage, cancel     Claude Code
   ▼
PHASE 4  Analysis               Haiku call + deterministic scorer   Codex + Claude
   ▼
PHASE 5  Generation             Sonnet, structured JSON out        Claude Code
   ▼
PHASE 6  UI                     Fourth tab, split panel            Codex → Claude
   ▼
PHASE 7  Cover letter           Second template, second call       Claude Code
```

### Effort estimates

| Phase | Hours | Risk |
|---|---|---|
| 1. Content bank | 4 to 6 | Low effort, high tedium |
| 2. Renderer with escaping and budget | 7 to 9 | Low, pure string work |
| 3. API client | 3 | Medium, SSE parsing |
| 4. Analysis | 3 | Low |
| 5. Generation | 4 | Medium, prompt tuning |
| 6. UI | 5 to 6 | Low |
| 7. Cover letter | 2 | Low |

**Total 28 to 33 hours.** Four weekend sessions before August 15 with slack.

### Sequencing principle

Phases 1, 2, and 5 have **zero API dependency** and retire the highest technical risk. Build them first.

Building the UI first means spending time debugging React while the actual hard problem, rendering a correct one page LaTeX document from structured data, sits untouched.

### Phase 0 output, completed

- Directories created: `resume/output/`, `src/generate/`, `electron/anthropic/`
- `.gitignore` updated to exclude `resume/output/`, `*.pem`, `*credentials*`
- `CLAUDE.md` and `AGENTS.md` written with identical content

Known nit: `CLAUDE.md` is itself full of em dashes. The writing rules correctly scope the no em dash rule to generated content, so this is not a logic error, but a model reading a context file dense with em dashes will drift toward them. Worth stripping.

### Phase 1 ordering, learned the hard way

**Correct `main.tex` before populating the content bank.** Building the bank from a resume that is about to change means doing it twice.

An agent correctly refused to run Task 2 because two instructions collided: "every bullet in `main.tex` must appear in the bank verbatim" and "CUDA kernel work goes in `doNotClaim`." That refusal was right behavior. Resolve the source document rather than instructing around the contradiction.

---

## 13. Environment setup

### LaTeX engine

**Tectonic 0.16.9**, installed at `%LOCALAPPDATA%\Programs\tectonic` and added to user PATH.

Single self contained executable that downloads packages on demand. No multi gigabyte TeX distribution.

Install notes for Windows, learned the hard way:

- The official PowerShell drop script fails when run from `C:\WINDOWS\system32` (permissions). Run from a normal directory.
- `winget search tectonic` returns nothing as of July 2026.
- If `WebClient.DownloadFile` throws a WebException, use `Invoke-WebRequest` and `Expand-Archive` instead, or download the zip in a browser. `WebClient` is legacy and trips over proxies and TLS negotiation.
- When setting PATH, read the **user** scope specifically:
  ```powershell
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dest", "User")
  ```
  Using `$env:Path` copies the entire merged system PATH into user scope and permanently bloats it.
- First compile is slow (30 to 90 seconds) while packages download, and requires network. Subsequent compiles are seconds.
- `Fontconfig error: Cannot load default config file` on Windows is harmless.

### Anthropic API

Key from console.anthropic.com. $10 prepaid credit covers the season. **Do not create the key until Phase 3**, since no API call happens before then.

### Skills

The personal context skills were uploaded to claude.ai (the web app) and are **not on disk**. Claude Code reads from `~/.claude/skills/`, so they must be placed there manually.

Required for Phase 1: `vineet-resume-context`.
Also available: `humanizer`, `resume-bullet-writer`, `resume-tailor`, `tech-resume-optimizer`, `job-description-analyzer`, `resume-quantifier`, `interview-prep-generator`, `cover-letter-generator`, `linkedin-profile-optimizer`.

---

## 14. ATS findings

Grounded in 2026 sources, applied to the actual rendered PDF.

### What was verified empirically

- **The two column skills block parses correctly.** Text extraction reads the entire left minipage, then the entire right minipage, in order. No scrambling.
- This is worth stating because generic advice is alarming: two column layouts failed in 7 of 8 systems in one 2026 test. The template avoids that because the minipages contain **only supplementary skill lists**, never experience or education. That matches the recommended mitigation exactly.
- Both PDFs are text selectable. Workday, Greenhouse, and Lever extract from text selectable PDFs as cleanly as from DOCX.

### Fixes applied to the template

1. Full URLs in the header instead of bare "Github" and "Portfolio". A parser extracts visible text, not the `href`, so a hyperlinked word loses the URL entirely.
2. Location added (`College Park, MD`). Many ATS filter on it.
3. Unclosed parenthesis in the Cloud and DevOps skills line closed. It had been shipping visibly broken.
4. Email switched to `vineet54@umd.edu`.
5. `TensorRT-LLM` added to skills. It appeared in a bullet but was missing from the list.
6. Em dash in the Education line replaced with a comma.

### Known minor issue, not worth fixing

`AWS` extracts as `A WS` on one line because XCharter's A-W kerning pair is wide enough that `pypdf` inserts a space. Low severity, since `AWS` also appears correctly in a bullet, so the keyword is covered.

### Rules for step 7, the post render ATS check

- Compute keyword coverage in **JavaScript**, deterministically. Never ask a model to output "an ATS score out of 100". That number is fabricated.
- The model returns **structured facts** (must-haves, role family, blockers). Code computes the **score**.
- Check the shipped document, not the requested content.

---

## 15. RESOLVED: the CUDA conflict

**Resolution, confirmed by the owner on July 19, 2026: he did NOT do CUDA kernel work.** The skill's do-not-claim list is correct. He worked at the inference framework and orchestration level, not the kernel level.

This is authoritative. Do not reopen it.

### What was wrong

An earlier template incorrectly attributed CUDA kernel authoring and kernel fusion work to Vineet. Those statements were false, have been removed, and must never enter the content bank or generated documents.

### Consequent rules

- **`CUDA kernel authoring`, `kernel fusion`, and `GPU kernel optimization` go in `doNotClaim`.**
- The CUDA bullet must **not** enter the content bank in any form, including paraphrased. This overrides the otherwise correct rule that every bullet in `main.tex` must appear in the bank verbatim.
- `CUDA` is removed from the skills list.
- **Speculative decoding is the strongest Runara story**, not benchmarking and not kernels.
- The "2 to 3x speculative decoding speedup" must never be claimed as a personal benchmark. It was measured by teammates on larger models. The claim is understanding of the conditions under which speedup occurs, not a personal number.

### Runara dates: RESOLVED

**April to May 2026.** The skill was correct, `main.tex` said March and was wrong.

### The correction to apply to main.tex

If this has not been applied yet, apply it before building the content bank.

```latex
  \headingBf{Runara.ai}{Apr 2026 -- May 2026}
  \headingIt{ML \& Inference Engineer Intern}{}
  \begin{resume_list}
    \item Implemented speculative decoding from scratch across two GPUs in PyTorch and HuggingFace Transformers, applying the paper's probabilistic rejection sampling criterion rather than naive argmax matching.
    \item Diagnosed a gap between 92\% isolated draft agreement and 29\% in-loop acceptance, tracing it to KV cache and verification input handling and showing argmax draft selection beats temperature sampling.
    \item Benchmarked Qwen3-Coder-480B across vLLM, SGLang, and TensorRT-LLM on RTX Pro 6000 Blackwell GPUs from 1K to 128K context, profiling TTFT, throughput, KV cache growth, and multi user scalability.
  \end{resume_list}
```

Summary line becomes:

> Software engineering grad student with 2+ years production experience, focused on multi-agent AI systems and LLM inference optimization, from agent orchestration (LangChain, LangGraph, Bedrock) down to speculative decoding and multi framework inference benchmarking on GPU workloads.

Skills line becomes:

```latex
  \textbf{LLM Inference \& Optimization}\enspace vLLM, SGLang, \mbox{TensorRT-LLM}, llama.cpp, quantization, speculative decoding, KV cache
```

Verbs are unique (Implemented, Diagnosed, Benchmarked). Bullets are 192 to 207 characters, two lines each.

**This section is stronger than what it replaces.** A 92 percent versus 29 percent acceptance gap root caused to KV cache handling is a debugging story defensible for twenty minutes in an interview. The kernel bullet was not defensible at all.

## 16. Missing content to add to the bank

Real work confirmed to exist but absent from the current resume. These are why the bank must be larger than the page.

**Xelpmoc**
- WebRTC real time interview system, 100+ concurrent sessions, sub 200ms latency
- React Native credentials wallet with blockchain webhooks, 30+ screens
- Twin production applications for a senior living network, 35 percent coordination efficiency gain

**Svipes**
- Video module refactor detail: async loading and caching, stutter reduced 40 to 70 percent, load time improved 1.3 seconds

**Projects not on the resume**
- Terrapin Events: React, FastAPI, MongoDB, Kubernetes, CAS SSO with JWT RBAC, Stripe webhooks, 100+ concurrent users, sub 200ms API
- AWS Video Analytics Streaming Platform: 3 Lambdas, EKS, S3, DynamoDB, SQS, AppSync GraphQL, CloudFormation, auto scaling 2 to 10 pods, zero critical vulnerabilities
- CollabDraw: Next.js 15, TypeScript, WebSocket, PostgreSQL, Prisma, monorepo
- MeetSpace: WebRTC peer to peer, screen sharing, recording, React, TypeScript, Express
- Activity Logger: React Native, Node.js, SQL
- Plywood Studio AI Chatbot: FastAPI, OpenAI with Hugging Face fallback, Redis caching
- Locra: on device vision AI for Android, TypeScript, active
- google-adk: Google ADK multi agent orchestration experiments

**Other locked metrics from the skill**
- Mentoring 50+ students in DSA and OOP
- Content platform, 5000+ Wikipedia articles deployed
- NLP accuracy improved 15 percent

---

## 17. Cover letter specification

Phase 7. Same machinery as the resume, simpler template.

### Format, 2026 standard

**250 to 350 words. One page. Four paragraphs maximum.** Recruiters skim in under 20 seconds. Length hurts.

- **Header:** reuse the resume letterhead exactly. Same font, same contact block, same rule. Then date, then company name and city. Address a named person if the JD gives one, otherwise "Dear Hiring Team". Never "To Whom It May Concern".
- **Paragraph 1, hook, 2 to 3 sentences.** Name the exact role, then one concrete reason grounded in something specific about the company. Not enthusiasm, a reason.
- **Paragraph 2, proof, 3 to 4 sentences.** The single strongest achievement mapping to their top requirement. One story with real numbers, not a list of three.
- **Paragraph 3, fit, 2 to 3 sentences.** Must reference something a generic letter could not. If it cannot be written honestly, drop it and ship three paragraphs.
- **Paragraph 4, close, 2 sentences.** Direct.

### Banned patterns

- "I am writing to express my strong interest in"
- "I am excited about the opportunity to"
- "passionate about" anything
- "leverage", "utilize", "spearheaded", "delve", "robust", "seamless"
- Tricolon lists, the rule of three cadence LLMs default to
- "Not only... but also"
- Uniform sentence length. Real writing varies from 4 words to 30.
- Any em dash
- "I look forward to discussing how I can contribute to your team's success"

Positive rules: contractions read as human, and a specific number always beats an adjective.

### Using the humanizer skill efficiently

**Do not run it as a second API call at runtime.** That doubles per application cost.

Instead, during the build: generate 5 sample cover letters against real JDs, run `humanizer` over each in Claude Code, collect what it flags, and fold those corrections into the generation prompt as explicit constraints. Pay the cost five times in development, zero times in production.

### One page enforcement

A word cap rather than a line budget. Instruct the model to stay under 320 words and assert it in code before rendering.

---

## 18. Decision log

Changes from the original July 16 plan, with reasons.

| Original | Changed to | Why |
|---|---|---|
| DOCX output | LaTeX to PDF | DOCX does not preserve the template. Pandoc destroys custom resume classes. |
| Model generates the resume | Model selects and rewrites bank entries | Prevents template drift and invented metrics |
| `electron-store` for the key | Electron `safeStorage` | Real OS keychain vs a bundled passphrase. Zero new dependencies. |
| ATS score from the model | Deterministic keyword coverage in JS | An LLM "ATS score out of 100" is a fabricated number |
| No one page strategy | Ranked overflow against a precomputed budget | Eliminates the compile, check, shrink retry loop |
| Spec Kit for planning | `/ultraplan` | Spec Kit is greenfield oriented and adds 20 to 40 percent API spend |
| `charter` font package | `XCharter` | `charter` silently killed all bold and italic under XeTeX |
| CUDA kernel fusion bullet | Speculative decoding bullets | Owner confirmed he did not do kernel work. False claim removed. |
| Runara dates March to May | April to May | Skill was correct, resume was wrong |
| 113 chars per line, 12pt | 119 chars per line, 11.96pt | Re-measured against the XCharter render |
| Install all nine resume skills | Install one, read five | Trigger collision with the architecture rule, plus context cost |

---

## 19. Quick reference for a new session

If you are starting fresh, this is the minimum you need:

1. **The architecture rule.** The model outputs structured JSON referencing content bank entries. JavaScript owns every byte of the `.tex`. Nothing else.
2. **Only steps 2 and 4 call the API.** Everything else is deterministic and stays that way.
3. **Constants:** 119 chars per bullet line, 11.96pt pitch, ~27 lines fixed overhead. Free space needs one re-measure after the Runara correction lands.
4. **No CUDA kernel work.** Section 15. It is in `doNotClaim` and must never appear in the bank or any generated document.
5. **No new npm dependencies without asking.** Including the Anthropic SDK.
6. **Plain JavaScript. No TypeScript.**
7. **Never relax `contextIsolation`.** New native capability means a new `ipcMain.handle` plus a narrow preload bridge.
8. **The writing rules in Section 2** apply to all generated content.
