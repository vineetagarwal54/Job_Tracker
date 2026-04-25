# JobTrack

A desktop app for tracking your job applications — built with React + Electron. Features one-click capture from job boards via a browser bookmarklet, deadline tracking, drag-and-drop reordering, and JSON export/import.

> **Note:** The features listed below with _(development)_ are on the `development` branch and have not yet been merged to `main`.

---

## What it does

- **Track applications** with status (Wishlist → Applied → OA → Interview → Offer / Rejected), priority, resume version, salary, location, recruiter info, and a full job description tab
- **Quick Add bookmarklet** — click a button in your browser bar while on any job posting to auto-extract company, role, location, salary, and job description, then open the app with the form pre-filled
- **Filter & search** by status, priority, resume version, or free-text across company/role/location
- **Sort** by date applied, deadline, company, status, priority, or custom drag-and-drop order
- **Deadline alerts** — "DUE SOON" and "EXPIRED" badges on rows
- **Export / Import** JSON backups — export is scoped to the active workspace
- **Workspaces** _(development)_ — separate your applications into named groups (e.g. "Internships", "Full Time 2027"); switch, create, rename, reorder, and delete workspaces with full data safety
- **Multi-select & bulk actions** _(development)_ — select multiple jobs, then bulk move to another workspace, bulk change status, or bulk delete with confirmation
- Data is stored locally in a JSON file (via Electron's IPC bridge); no account or internet connection required

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 18 |
| Desktop shell | Electron 33 |
| Build tool | Vite 5 |
| Styling | Inline styles + global CSS-in-JS (`styles.js`) |
| Storage | Local JSON file via Electron IPC (`electron/main.cjs`) |
| Packaging | electron-builder (Windows `.exe`, macOS `.dmg`, Linux `AppImage`) |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm v9 or later

### Install

```bash
git clone https://github.com/vineet54/JobTrack.git
cd JobTrack
npm install
```

### Run in development

```bash
npm run electron
```

This starts the Vite dev server and Electron together. The app opens automatically once the dev server is ready.

### Build a distributable

```bash
npm run electron:build
```

The installer is output to `release/`.

| Platform | Output | Notes |
|---|---|---|
| Windows | `.exe` (NSIS installer) | Run `electron:build` on a Windows machine |
| macOS | `.dmg` installer | **Must be built on a Mac** — run `electron:build` on macOS |
| Linux | `.AppImage` | Run `electron:build` on a Linux machine |

> electron-builder does not support cross-compilation (e.g. you can't build a `.dmg` on Windows). Each platform's binary must be built on that platform.

### Automated releases (GitHub Actions)

This repo includes a release workflow at [`.github/workflows/release.yml`](.github/workflows/release.yml) that builds installers for all three platforms in parallel and attaches them to a GitHub Release.

To cut a release:

```bash
git tag v1.0.1
git push --tags
```

The workflow publishes a **draft** release — review the artifacts on the GitHub Releases page and publish when ready. Users can then download the installer for their OS without needing to clone the repo.

---

## Quick Add Setup (Bookmarklet)

The bookmarklet lets you capture job details from any page in one click:

1. Open JobTrack and click **Quick Add Setup** in the top-right header
2. Press `Ctrl+Shift+B` (Windows) or `Cmd+Shift+B` (Mac) to show your browser's bookmarks bar
3. Drag the **"+ Save to JobTrack"** button into the bookmarks bar
4. Navigate to any job posting and click the bookmarklet — JobTrack opens with the form pre-filled

**Supported job boards:** Handshake, LinkedIn, Indeed, Jobright, and company career pages

The bookmarklet extracts structured data (JSON-LD), og:title, and DOM selectors to populate company, role, location, salary, and source. The job description is copied to your clipboard automatically.

---

## Project Structure

```
JobTrack/
├── electron/
│   ├── main.cjs           # Electron main process, IPC handlers, deep-link (jobtrack://)
│   └── preload.cjs        # Exposes storage + electronAPI to renderer
├── src/
│   ├── main.jsx           # React entry point
│   ├── JobTracker.jsx     # Root component — wires all state and layout
│   ├── constants.js       # Statuses, priorities, resume versions, sample data
│   ├── styles.js          # Global CSS injected as a style tag
│   ├── components/
│   │   ├── Header.jsx         # Title bar + status count pills
│   │   ├── Filters.jsx        # Search, priority, resume, sort dropdowns
│   │   ├── WorkspaceSwitcher.jsx  # Tab bar for switching/managing workspaces (development)
│   │   ├── JobList.jsx        # Drag-and-drop list container
│   │   ├── JobCard.jsx        # Job row with status/priority dots and action buttons
│   │   ├── JobDetails.jsx     # Expandable details / JD / status panel
│   │   ├── JobForm.jsx        # Add/edit modal form
│   │   ├── QuickAddSetup.jsx  # Bookmarklet instructions modal
│   │   ├── Toast.jsx          # Notification banner
│   │   ├── EmptyState.jsx     # Empty list message
│   │   └── FormField.jsx      # Labelled form field wrapper
│   ├── hooks/
│   │   ├── useJobs.js         # All app state: workspaces + jobs + persistence
│   │   ├── useFilters.js      # Filter and sort state
│   │   └── useJobSorting.js   # Memoised filter + sort logic
│   └── utils/
│       ├── storageHelpers.js      # IPC storage wrapper + migration
│       ├── bookmarklet.js         # Bookmarklet JS URL generator
│       ├── validation.js          # Form validation
│       ├── deadline.js            # Deadline date helpers
│       └── jobDescriptionCleaner.js  # HTML → plain text cleaner
├── index.html
├── vite.config.js
└── package.json
```

---

## Data & Privacy

All data is stored in a local JSON file on your machine — nothing is sent to any server. You can export a full backup at any time via the **Export** button and restore it with **Import**.

**Where your data lives:**

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\JobTrack\data.json` |
| macOS | `~/Library/Application Support/JobTrack/data.json` |
| Linux | `~/.config/JobTrack/data.json` |

If the data file ever gets corrupted (e.g. disk full during a write), JobTrack saves a backup copy alongside it (`data.json.corrupted-<timestamp>`) and shows a load-error banner in the app — so you can recover instead of silently losing history.

---

## License

MIT
