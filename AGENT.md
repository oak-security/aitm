# AGENT.md

Operational guide for any AI coding agent (or human) working in this repository.
Read this before touching code. It is the source of truth for conventions, build
commands, and the non-negotiable security/branding invariants.

## What this project is

A cross-platform **desktop** application for AI-assisted threat modeling using the
**TRACE** framework (https://github.com/oak-security/TRACE). It is a desktop port of
the web app at `/Users/stefanbeyer/Documents/bot-runs/thread-model-dashboard`
(Node/Express + vanilla-JS, Oak-branded, OpenAI-backed).

Differences from the source web app:

- **Electron desktop app**, not a hosted web server. No GitHub OAuth org gating.
- **Mostly Harmless (MHL·42) branding**, not Oak. See "Branding invariants".
- **User-supplied AI API key**, stored encrypted on-device. Not a backend `.env`.
- **Generic** threat modeling, not Web3-only. Web3 remains a first-class profile.
- **TRACE phases are optional/toggleable** per project, except the core required set.

Product name: **AiTM** — "AI Threat Modeller" (also the working-directory name).

## Stack

- **Electron** (latest LTS-aligned major). `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`.
- **Main process** (Node): app lifecycle, windows, IPC handlers, secure key store,
  file-based project store, ingestion (git/zip/doc), AI provider adapters, PDF export.
- **Preload**: `contextBridge`-exposed typed API only. No raw `ipcRenderer`, no Node
  globals reach the renderer.
- **Renderer**: ported vanilla HTML/CSS/JS from the source app. No framework required.
  A fetch→IPC shim keeps the ported `app.js` close to the original.
- **Packaging**: `electron-builder`. macOS notarized (Developer ID), Windows
  Authenticode-signed, Linux AppImage + deb.

There is intentionally **no heavy frontend build step**. Keep the renderer simple.

## Repo layout (target)

```
AiTM/
  AGENT.md            # this file
  SPEC.md             # product + technical spec
  PLAN.md             # implementation plan / milestones
  package.json
  electron-builder.yml
  src/
    main/             # main process
      index.js        # app bootstrap, window, menu, lifecycle
      ipc/            # one module per IPC channel group; validates all input
      keystore.js     # safeStorage-backed API-key vault
      projects/       # file-based project store + schema/migrations
      ingest/         # folder.js, files.js (+ deferred github.js/zip.js for v1.1)
      ai/             # provider adapters + structured-call orchestration
      report/         # report assembly + PDF export
      phases.js       # TRACE phase registry (required/optional/appliesWhen)
    preload/
      index.js        # contextBridge API surface
    renderer/
      index.html
      styles.css      # MHL design tokens live here
      app.js          # ported workbench logic, calls window.api.*
      assets/         # MHL logos, Inter font, icons (vendored)
  test/
    fixtures/         # ingestion + AI fixtures (DeFi, L1, generic IT, web app...)
```

## Build / run / test

(Define these scripts in `package.json` as you scaffold; agents should run them, not
invent ad-hoc commands.)

- `npm run dev` — launch Electron against the local renderer with devtools.
- `npm run check` — `node --check` over main/preload + lint.
- `npm test` — unit/integration tests (ingestion guards, schema migration, key
  non-persistence, phase gating).
- `npm run dist` — build signed/notarized installers via electron-builder.

Always run `npm run check` and `npm test` before claiming a change is done.

## Security invariants (do not violate)

Treat the **renderer as untrusted**. The main process is the trust boundary.

1. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
   `webSecurity: true`. No `@electron/remote`.
2. Strict CSP in `index.html`. Block in-app navigation to remote origins, block
   `window.open`, deny `<webview>`/`webContents` creation. Open external links via
   `shell.openExternal` only after host allowlist check.
3. **Validate every IPC payload** in the main process (type, size, shape, path
   confinement). Never pass renderer strings to `child_process` or `fs` without
   validation.
4. **API key**: stored only via `safeStorage` (OS keychain/DPAPI/libsecret),
   encrypted at rest in `userData`. Check `safeStorage.isEncryptionAvailable()`;
   if false, warn explicitly and do not silently downgrade. The key must never
   appear in: project files, JSON exports, reports, logs, crash dumps, or IPC
   responses back to the renderer. The renderer only sees "key set: yes/no".
5. **Ingestion hardening** — v1 is local-only (folder and/or files); a project may
   hold several sources that complement each other:
   - Local folder: user-picked via native dialog; confine the walk to the chosen
     root, never follow symlinks escaping it, honor `.gitignore`, skip binaries,
     apply byte/file-count caps. Reuses the source app's digest walker minus clone.
   - Local files: user-picked; allowlist doc types `.md/.txt/.docx/.pdf` plus source
     files; reject macro-enabled Office; byte cap.
   - Deferred to v1.1 (GitHub clone, ZIP upload): keep the source app's SSRF/IP
     allowlisting + DNS re-resolution and zip-slip/symlink/ratio/count guards, but do
     not wire them in v1.
6. **AI egress**: requests go only to the configured provider host over TLS. Source
   digests leave the device to that provider. The UI must surface this privacy fact
   before first send.
7. Auto-update (if enabled) must verify signatures. Disable devtools and the
   reload/inspect menu items in production builds.
8. No telemetry without an explicit, default-off opt-in.

## Branding invariants (MHL·42)

Source: https://github.com/mhl42/branding. Vendor assets into `renderer/assets/`.

- Colors only: **Ink `#0E1116`**, **Paper `#FAF6EE`**, **Don't-Panic Gold `#F5C518`**.
- Gold is a single accent **used once per surface**. Never recolor the logo except in
  ink/paper/gold. No shadows, stretching, or rotation of the mark.
- Typography: **Inter** (400/500/700/800). Vendor the woff2 files; do not hotlink.
- Use the mark + phrase on first contact (window splash / about), drop it for repeats.
- Replace all Oak assets (BDO Grotesk, oak logos, `#FFC965`→`#9C0069`) — none ship.
- Copy rule inherited from source: say **"protected assets"**, never "crown jewels".

## Domain conventions

- **TRACE phases** live in `src/main/phases.js` as a registry. Each phase declares
  `id`, `title`, `required`, `defaultEnabled`, and `appliesWhen(classification)`.
  Required phases cannot be disabled. The workflow UI, auto-run, and report all derive
  from the project's enabled-phase set. See SPEC.md "Phase model".
- **AI provider adapters** implement a common interface (`structuredCall`,
  `models`, `validateKey`). `OpenAIResponsesAdapter` (the `/v1/responses` endpoint
  with JSON-schema structured output) is the only adapter for v1. Do not hard-code
  OpenAI elsewhere; go through the adapter.
- All AI output is a **draft** until the user accepts/edits it. Preserve the
  per-phase approval gates from the source app.

## When extending

- New provider → add an adapter, register it, expose model choices in Settings. Do
  not change call sites.
- New optional phase → add to the phase registry; never make it required by default.
- New ingestion type → add a guarded module under `ingest/`, mirror existing caps.

Keep changes idiomatic and minimal. Match surrounding style. Comment only where intent
is non-obvious. See SPEC.md and PLAN.md for the full design and sequencing.
