# AGENT.md

Operational guide for any AI coding agent (or human) working in this repository.
Read this before touching code. It is the source of truth for conventions, build
commands, and the non-negotiable security/branding invariants.

## What this project is

Cross-platform AI-assisted threat modeling using the **TRACE** framework
(https://github.com/oak-security/TRACE). Started as a desktop port of an internal
Node/Express + vanilla-JS web dashboard (Oak-branded, OpenAI-backed); it now ships
**three frontends over one core** — Electron desktop, a terminal UI (`tui/`), and a
local web server (`server/`) — all single-user against the same project store.

Differences from the source web app:

- **Local-first**, not a hosted web server. No accounts, no OAuth, no org gating, no
  multi-tenancy, in any frontend (SPEC.md section 2).
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
- **Packaging**: `electron-builder` (config in `electron-builder.js`). Only macOS is
  shipped: notarized (Developer ID) `.dmg`/`.zip`, built and published by CI on `v*`
  tags. The Windows NSIS and Linux AppImage/deb targets stay configured for local builds
  but are unsigned, untested, and never published — the README documents them as
  build-from-source with an "untested" warning. Updates via `electron-updater` from
  GitHub Releases.

There is intentionally **no heavy frontend build step**. Keep the renderer simple.

## Repo layout (target)

```
AiTM/
  AGENT.md            # this file
  SPEC.md             # product + technical spec
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
      ingest/         # index.js (native pickers), digest.js (walker + doc extraction)
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
    tui.test.js       # TUI shim, target resolution, pipeline helpers
    webserver.test.js # host/origin guards, upload sanitizing, preload contract, e2e
    adapters.test.js  # Anthropic refusal/truncation/effort, model-table drift guard
  tui/                # aitm-tui: Ink/React terminal frontend (own package.json, ESM,
                      #   no build step). Loads src/main/* outside Electron via a
                      #   Module._load shim (tui/src/shim.js) that fakes `electron`
                      #   (app.getPath -> shared userData) and swaps keystore.js
                      #   (env vars / mode-600 file) and stream.js (EventEmitter).
                      #   Adds git-URL clone ingestion and an AI scope filter
                      #   (orchestrate.scopeFilter). See tui/README.md.
  server/             # aitm-web: local web frontend (own package.json, ESM). Same
                      #   core-loading shim as the TUI (server/src/shim.js): shared
                      #   userData dir, keystore -> tui/src/keys.js, stream -> SSE
                      #   fanout. Single user, no auth, loopback-bound (SPEC.md s.2);
                      #   mutating requests need a loopback Origin if they send one.
                      #   Browser preload replacement is server/web/web-api.js (fetch +
                      #   SSE + upload/repo ingestion + download export).
                      #   See server/README.md.
```

## Core reuse invariant

`src/main/*` (orchestrate, digest, projects/store, settings, phases, report, adapters)
must stay Electron-decoupled enough that the tui/ and server/ shims can load it by
faking exactly three touchpoints: `electron` (app.getPath), `keystore.js`, `stream.js`.
Both shims intercept those by absolute AND relative require path. When adding a new
`require("electron")` or OS-vault call in src/main, either keep it behind one of those
three modules or extend both shims. All three frontends are single-user against one
shared data dir, so no shim overrides `settings.js` or partitions the store; keep it
that way. `orchestrate.cancelAll(scope)` still accepts an optional scope (via
`setScopeProvider`), but nothing sets one now: the default null scope means
`cancelAll()` aborts every in-flight call, which is the desktop behaviour.

## Build / run / test

(Define these scripts in `package.json` as you scaffold; agents should run them, not
invent ad-hoc commands.)

- `npm run dev` — launch Electron against the local renderer with devtools.
- `npm run tui` — the terminal frontend. `npm run web` — the local web frontend.
- `npm run check` — `node --check` over the main/preload/renderer and server entry
  points. There is no linter; keep it a syntax gate.
- `npm test` — `node --test` over `test/**/*.test.js` (ingestion and upload guards,
  schema migration, phase gating, shim loading, provider-adapter behaviour, the web
  host/origin guards, and an e2e pass over the web server).
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
4. **API keys** (one per provider). In Electron: stored only via `safeStorage`
   (OS keychain/DPAPI/libsecret) as an encrypted `{ openai, anthropic }` map in
   `userData/keystore.bin`. Check `safeStorage.isEncryptionAvailable()`; if false, warn
   and do not silently downgrade. Outside Electron `safeStorage` does not exist, so the
   TUI and web frontends fall back to the provider env vars, else a mode-600 JSON file
   (`tui/src/keys.js`, `~/.config/aitm-tui/keys.json`) — plaintext at rest, protected by
   file permissions only, and deliberately not shared with the Electron vault. Whatever
   the backing store, keys must never appear in: project files, JSON exports, reports,
   logs, crash dumps, or responses to the renderer. The renderer only ever sees
   per-provider `{ configured, last4 }` (and, in-session, a verified flag from a
   successful call).
5. **Ingestion hardening** — a project may hold several sources that complement each
   other:
   - Local folder: user-picked via native dialog (Electron) or uploaded via the browser
     picker (web); confine the walk to the chosen root, never follow symlinks escaping
     it, honor `.gitignore`, skip binaries, apply byte/file-count caps.
   - Local files: user-picked; allowlist doc types `.md/.txt/.docx/.pdf` plus source
     files; reject macro-enabled Office; byte cap.
   - Browser uploads: sanitize every attacker-controlled relative path (no absolute
     paths, no drive letters, no backslashes, no `..`), re-check confinement after the
     join, and digest in a temp dir that is always deleted (`server/src/ingest.js`).
   - Git URL (TUI and web): shallow clone, digest, delete. Reject a URL starting with
     `-` and pass `--` before it so it cannot become a git option. **The source app's
     SSRF/IP-allowlisting and DNS re-resolution guards are NOT wired**, so this will
     reach any host the caller names. That is tolerable only because the caller is the
     local operator; it is why neither frontend may be exposed to other users. Add the
     guards before changing that.
   - Not wired: ZIP upload (would need zip-slip/symlink/ratio/count guards).
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
  GPT-5 `reasoning.effort` and to Anthropic `output_config.effort`. Don't hard-code a
  provider at call sites; go through `orchestrate`.
- **Models**: the report and other synthesis steps use the *fast* model; STRIDE and
  coordination use the *deep* model. Both are per-provider, set in Settings. Defaults
  live in **three** places that must agree — `PROVIDERS` in `src/renderer/app.js`,
  `MODEL_DEFAULTS` in `tui/src/tui/App.js`, and `DEFAULTS` in `src/main/settings.js`
  (which decides only the initial provider). A test in `test/adapters.test.js` fails if
  the first two drift or if a superseded/date-suffixed id reappears.
- **Anthropic adapter constraints** (non-obvious, and load-bearing): structured output
  is a *forced tool call*, so never send `thinking: {type: "disabled"}` — with thinking
  off, Opus 5 can emit the tool call as plain text and the step returns nothing. Claude
  5 models think by default and thinking shares `max_tokens` with the tool input, which
  is why `MAX_TOKENS` is 64000. Handle `stop_reason: "refusal"` before the empty-stream
  check: classifiers decline with HTTP 200 and no tool call, and threat-modeling
  prompts sit close to the cyber policy line.
- All AI output is a **draft** until the user accepts/edits it; per-phase approval
  gates remain. Re-running the full pipeline resets derived data first
  (`store.resetAnalysis`); attack trees are one-per-threat and accumulative.

## When extending

- New provider → add an adapter, register it, expose model choices in Settings. Do
  not change call sites.
- New optional phase → add to the phase registry; never make it required by default.
- New ingestion type → add a guarded module under `ingest/`, mirror existing caps.

Keep changes idiomatic and minimal. Match surrounding style. Comment only where intent
is non-obvious. See SPEC.md for the full design.
