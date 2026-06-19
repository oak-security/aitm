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
- **Oak Security branding** (BDO Grotesk, gold→magenta). The AiTM node-graph mark is
  the app logo; the Oak logo appears as a "by Oak Security" lockup. See "Branding".
- **User-supplied AI API keys**, one per provider, stored encrypted on-device (not a
  backend `.env`). OpenAI and Anthropic both ship.
- **Generic** threat modeling, not Web3-only. Web3 remains a first-class profile.
- **TRACE phases are optional/toggleable** per project, except the core required set.

Product name: **AiTM** — "AI Threat Modeller" (also the working-directory name).

## Stack

- **Electron** (latest LTS-aligned major). `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`.
- **Main process** (Node): app lifecycle, windows, IPC handlers, secure key store,
  file-based project store, local ingestion (folder/files), AI provider adapters
  (streaming, SSE), report assembly + PDF export, electron-updater.
- **Preload**: `contextBridge`-exposed typed API only. No raw `ipcRenderer`, no Node
  globals reach the renderer. Also exposes an `ai.onStream` event subscription.
- **Renderer**: vanilla HTML/CSS/JS (wrapped in an IIFE so top-level consts don't
  collide with the non-configurable `window.api` global). No framework. Calls
  `window.api.*`; a persistent AI status bar consumes streamed progress events.
- **Packaging**: `electron-builder` (config in `electron-builder.js`). macOS notarized
  (Developer ID), Windows NSIS, Linux AppImage + deb. CI release on `v*` tags. Updates
  via `electron-updater` from GitHub Releases.

There is intentionally **no heavy frontend build step**. Keep the renderer simple.

## Repo layout (target)

```
AiTM/
  AGENT.md            # this file
  SPEC.md             # product + technical spec
  PLAN.md             # implementation plan / milestones
  package.json
  electron-builder.js   # build/sign/notarize config + GitHub publish
  .github/workflows/release.yml
  build/                # icon.icns/png, entitlements, render-icon helper (buildResources)
  src/
    main/             # main process
      index.js        # app bootstrap, window, menu, lifecycle, auto-update
      stream.js       # emitStream -> renderer 'ai:stream' events
      ipc/            # IPC handlers; validates all input
      keystore.js     # safeStorage-backed per-provider key vault
      projects/       # file-based store + schema/migrations (store.resetAnalysis)
      ingest/         # folder.js, files.js, digest.js (deferred github/zip for v1.1)
      ai/             # index (registry), openai-responses, anthropic, sse, prompts,
                      #   schemas, orchestrate (streaming, cancel, effort)
      report/         # render.js (md->html) + pdf.js (Oak-branded)
      phases.js       # TRACE phase registry (required/optional/appliesWhen)
    preload/
      index.js        # contextBridge API surface (+ ai.onStream)
    renderer/
      index.html
      styles.css      # Oak design tokens live here
      app.js          # workbench logic, calls window.api.*
      assets/         # AiTM mark + app icon, oak-white/black.svg, BDO Grotesk (vendored)
  test/
    core.test.js      # schema migration, phase seeding, render, ingestion guards
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
4. **API keys** (one per provider): stored only via `safeStorage` (OS keychain/DPAPI/
   libsecret) as an encrypted `{ openai, anthropic }` map in `userData/keystore.bin`.
   Check `safeStorage.isEncryptionAvailable()`; if false, warn and do not silently
   downgrade. Keys must never appear in: project files, JSON exports, reports, logs,
   crash dumps, or IPC responses to the renderer. The renderer only sees per-provider
   `{ configured, last4 }` (and, in-session, a verified flag from a successful call).
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
6. **AI egress**: requests go only to the configured provider host over TLS, and are
   streamed (SSE) with no wall-clock timeout; in-flight calls are cancellable via an
   `AbortController` registry (`orchestrate.cancelAll` / `ai.cancel`). Source digests
   leave the device to that provider — the UI surfaces this in Settings.
7. Auto-update (if enabled) must verify signatures. Disable devtools and the
   reload/inspect menu items in production builds.
8. No telemetry without an explicit, default-off opt-in.

## Branding (Oak Security)

Tokens live in `renderer/styles.css` `:root`. Reference: https://github.com/oak-security/resources/tree/main/brand.

- Palette: ink `#000`, workspace `#F7F6F5`, brand **gold `#FFC965` → magenta `#9C0069`**
  gradient (`--gradient`). Severity: high `#8a005d`, critical `#5b0019`.
- Typography: **BDO Grotesk** (400/500/700/800), vendored woff2; do not hotlink.
- Buttons: primary is ink and morphs to the gradient on hover; danger is magenta
  outline. Active nav is a solid white pill. Gradient accents on section rules, the
  status bar, and the active-nav badge.
- The **AiTM node-graph mark** (`assets/logo/aitm-mark.svg` / `app-icon`) stays the app
  logo. The **Oak logo** (`oak-white.svg`) appears only as a "by Oak Security" lockup.
- The report PDF/HTML is an Oak deliverable but states it is prepared *independently
  using Oak tooling*, dependent on user input — do not claim Oak authored it.
- Copy rule inherited from source: say **"protected assets"**, never "crown jewels".

## Domain conventions

- **TRACE phases** live in `src/main/phases.js` as a registry. Each phase declares
  `id`, `title`, `required`, `defaultEnabled`, and `appliesWhen(classification)`.
  Required phases cannot be disabled. The workflow UI, auto-run, and report all derive
  from the project's enabled-phase set. See SPEC.md "Phase model".
- **AI provider adapters** (`src/main/ai/`) implement a common interface:
  `structuredCall({ model, name, schema, system, user, key, signal, onDelta, effort })`
  and `validateKey`. Both **OpenAI** (`/v1/responses`, JSON-schema strict) and
  **Anthropic** (Messages API, forced tool call) ship, selected via `settings.provider`
  through `getAdapter`. Both stream and call `onDelta` per chunk. `effort` maps to
  GPT-5 `reasoning.effort` (ignored elsewhere). Don't hard-code a provider at call
  sites; go through `orchestrate`.
- **Models**: the report and other synthesis steps use the *fast* model; STRIDE and
  coordination use the *deep* model. Both are per-provider, set in Settings.
- All AI output is a **draft** until the user accepts/edits it; per-phase approval
  gates remain. Re-running the full pipeline resets derived data first
  (`store.resetAnalysis`); attack trees are one-per-threat and accumulative.

## When extending

- New provider → add an adapter, register it, expose model choices in Settings. Do
  not change call sites.
- New optional phase → add to the phase registry; never make it required by default.
- New ingestion type → add a guarded module under `ingest/`, mirror existing caps.

Keep changes idiomatic and minimal. Match surrounding style. Comment only where intent
is non-obvious. See SPEC.md and PLAN.md for the full design and sequencing.
