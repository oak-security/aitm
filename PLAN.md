# Implementation Plan — AiTM Desktop Threat Modeler

Target: Electron desktop port of `thread-model-dashboard`, MHL-branded, user-supplied
key, generic + TRACE phases. Read SPEC.md and AGENT.md first.

Sequencing principle: get a secure, runnable shell first, port the renderer behind an
IPC shim, then move backend logic module-by-module, branding last-but-continuous.
Each milestone ends with `npm run check` + tests green and a manual smoke check.

## M0 — Scaffold & secure shell (foundation)

- Init `package.json`, Electron, `electron-builder`, lint, test runner.
- Main bootstrap (`src/main/index.js`): single window, app menu, lifecycle.
- Harden `BrowserWindow`: `contextIsolation`, `sandbox`, `nodeIntegration:false`,
  `webSecurity`, no remote module; strict CSP meta in `index.html`; block remote
  navigation/`window.open`; route external links through `shell.openExternal` w/ host
  allowlist.
- Preload bridge skeleton (`window.api`) with a `ping` channel and input-validation
  helper used by all future handlers.
- `npm run dev` launches an empty hardened window.

Acceptance: window opens; devtools off in prod build; CSP blocks an inline-script test;
no Node globals reachable from renderer console.

## M1 — Port renderer behind IPC shim

- Copy `index.html`, `styles.css`, `app.js` from the source app into `src/renderer/`.
- Add a `fetch`→`window.api.invoke` shim so existing `fetch('/api/...')` call sites
  resolve to IPC channels with minimal edits; stub handlers return fixtures.
- Move project state from `localStorage` to the file-based project store (M2) behind
  the same accessor functions; keep export/import.
- Strip GitHub-OAuth UI and auth status checks (single-user desktop).

Acceptance: full workbench renders and navigates against stubbed handlers; create/edit
project works against the (temporary in-memory) store.

## M2 — Project store, settings, keystore

- `projects/`: file-per-project JSON in `userData/projects/`, active-project pointer,
  CRUD, atomic writes, `schemaVersion` + migration from source schema (v1→v2).
- Export/import: validate version, normalize, re-ID on collision, reject malformed.
- `keystore.js`: `safeStorage` vault; `status/set/clear/test`; refuse plaintext
  fallback silently (warn if `isEncryptionAvailable()` is false).
- `settings.js`: provider/model selection, privacy-ack flag.

Acceptance: projects persist across restart; export reimports cleanly into a fresh
profile; malformed import rejected with clear error; key set/cleared, never present in
project files/exports/logs (assert in a test).

## M3 — AI provider adapter + phase-aware orchestration

- `ai/adapter.js` interface + `ai/openai-responses.js` (`/v1/responses`, JSON-schema
  structured output), porting `callStructuredOpenAI`. Key injected in main only.
- Port the six structured calls as IPC handlers: classify, traceModel (classify +
  system-model), stride, attackTree, coordination, report. Reuse existing schemas;
  generalize system prompts from "Web3/Oak" to domain-profile-driven, method-neutral
  wording.
- `phases.js` registry (required/optional/`appliesWhen`); orchestration and auto-run
  derive their sequence from the project's enabled-phase set; skip/auto-approve rules
  carried over (top-3 suitable threats for trees, graceful skip).

Acceptance: with a real key, each phase produces a draft; disabling an optional phase
removes it from nav, auto-run, and report; auto-run completes end-to-end on a fixture.

## M4 — Ingestion (local-only, hardened)

v1 sources are local-only: a folder and/or individual files. A project may hold
several sources (e.g. a code folder + a docs folder/files) that complement each other.

- `ingest/folder.js`: local directory chosen via native dialog; walk confined to the
  root, no symlink escapes, honor `.gitignore`, skip binaries, byte/file caps. Reuses
  the source app's digest walker minus the clone step.
- `ingest/files.js`: user-picked local files; allowlist doc types (md/txt/docx/pdf via
  `mammoth`/`pdf-parse`) plus source files; reject macro-enabled Office; byte cap.
- Wire to `ingest.folder` / `ingest.files` / `ingest.removeSource` IPC; append source
  digests without overwriting prior context; never persist raw copies beyond digests.
- Deferred to v1.1: `ingest/github.js` and `ingest/zip.js` with the source app's SSRF
  and zip-slip hardening — port the code but leave it unwired.

Acceptance: a local folder and a set of local files each ingest and produce digests;
multiple sources coexist and append; folder symlink-escape and disallowed file types
are rejected; no raw copies persist beyond digests.

## M5 — Generic profiles & TRACE model UI

- Domain-profile vocabularies (assets/actors/invariants) and profile-defaulted optional
  phases (SPEC §8). Profile selectable/overridable in classification.
- Rename/relabel "System Model" view to the TRACE model (actors, roles, assets,
  invariants, components, trust boundaries, value flows, edges, open questions).
- Scope view (P0): boundaries, in/out of scope, assumptions, source inventory.
- Phase-toggle UI with mid-project disable warnings.

Acceptance: a non-Web3 fixture (e.g. web app / cloud infra) classifies sensibly and
produces a coherent TRACE model + STRIDE without Web3-specific noise; Web3 fixture still
flags coordination relevance and defaults P5 on.

## M6 — Report & PDF export

- Port report assembly; sections follow TRACE P6 (exec summary, system overview,
  decomposition, protected assets, actors, invariants, trust boundaries, STRIDE,
  ranking, attack trees, optional coordination, recommendations/roadmap, residual
  risks/open questions, appendices, legal notice). Exclude disabled phases.
- PDF export via main-process render (electron print-to-PDF or ported `pdfkit`),
  MHL-formatted cover + section breaks; save dialog.
- Legal/boundary notice: design-level analysis, AI draft needs expert review, no
  warranty; license language as applicable.

Acceptance: report renders from corrected state; PDF exports with MHL cover and section
breaks; disabled phases absent from output.

## M7 — MHL branding pass

- Vendor MHL logos/icons + Inter woff2 into `renderer/assets/`; remove all Oak assets
  (BDO Grotesk, oak logos, gold→magenta).
- Replace design tokens in `styles.css`: Ink/Paper/Gold, Inter, gold-once-per-surface.
- App icon, window/about mark + phrase, splash. "Protected assets" copy throughout.

Acceptance: no Oak asset or color remains (grep clean); UI matches MHL palette/type;
gold accent appears once per surface.

## M8 — Packaging, signing, hardening review

- `electron-builder` config for mac/win/linux; code-signing + notarization wiring
  (document credential prerequisites).
- Production hardening: devtools/reload disabled, CSP audited, dependency audit on CI,
  pin/lock deps, optional signed auto-update (defer if not needed).
- "Reveal data folder" + "reset all data" actions.

Acceptance: signed/notarized macOS build launches without Gatekeeper warning; Windows
build installs without SmartScreen block (with cert); Linux AppImage runs.

## M9 — Verification & test suite

- Tests: project CRUD/reload, export/import round-trip + malformed rejection, key
  non-persistence, ingestion guards, phase gating (enable/disable affects nav/auto-run/
  report), classification fixtures per profile, STRIDE coverage-or-N/A, attack-tree
  edit survives reload/export, report section completeness, IPC input validation.
- Manual: desktop layout on all three OSes; privacy-notice flow; key error states.

Acceptance: suite green in CI; manual checklist signed off.

## Risks & mitigations

- **macOS notarization / Windows signing friction** → set up Developer ID + Authenticode
  certs before M8; budget time for first notarization round-trip.
- **`pdf-parse`/`mammoth` native/behavioral quirks under Electron sandbox** → run
  ingestion in main process (not sandboxed renderer); validate with fixtures early (M4).
- **Bundle size (~150 MB)** → accepted per framework decision; revisit Tauri sidecar
  only if a hard constraint appears. Provider/ingestion modules kept portable.
- **Prompt generalization regressions** → keep per-profile fixtures; compare Web3 output
  against the source app to avoid quality loss when de-Web3-ifying prompts.
- **Key leakage surface** → dedicated non-persistence test in M2 and a log scrubber.

## Suggested order of execution

M0 → M1 → M2 → M3 → M4 in sequence (each unblocks the next). M5/M6 depend on M3+M4.
M7 (branding) can proceed in parallel from M1 onward but must finish before M8. M8/M9
last. First genuinely useful internal build lands at end of M6.
