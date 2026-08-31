# AGENT.md

Operational guide for any AI coding agent (or human) working in this repository.
Read this before touching code. It is the source of truth for conventions, build
commands, and the non-negotiable security/branding invariants.

## What this project is

Cross-platform AI-assisted threat modeling using the **TRACE** framework
(https://github.com/oak-security/TRACE). Started as a desktop port of an internal
Node/Express + vanilla-JS web dashboard (Oak-branded, OpenAI-backed); it now ships
**three UIs and two programmatic adapters over one engine package** — Electron
desktop, terminal UI, local web UI, headless CLI, and an API-only server mode. The
Electron app lives at the repository root; every non-Electron mode ships from
`packages/cli`. All modes are single-user against the same project store.

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
- **Engine package** (`@oak-security/aitm-engine`): file-based project store, local
  ingestion, AI provider adapters and orchestration, phase sequencing, and report
  assembly. It accepts its data directory, key store, and event sink as dependencies
  and must never import Electron.
- **Main process** (Node): Electron lifecycle, windows, IPC, native file dialogs,
  `safeStorage`, and PDF/save dialogs. It adapts those platform facilities to the
  engine package.
- **Preload**: `contextBridge`-exposed typed API only. No raw `ipcRenderer`, no Node
  globals reach the renderer. Also exposes an `ai.onStream` event subscription.
- **Workbench package** (`@oak-security/aitm-workbench`): vanilla HTML/CSS/JS
  (wrapped in an IIFE so top-level consts don't collide with the non-configurable
  `window.api` global). No framework. Calls
  `window.api.*`; a persistent AI status bar consumes streamed progress events.
- **Packaging**: the Electron app and CLI are separate products at the same version.
  The CLI package has no Electron dependency and is published to GitHub Packages.
  `electron-builder` (config in `electron-builder.js`) packages only the desktop app.
  Only macOS is shipped: notarized (Developer ID) `.dmg`/`.zip`, built and published
  by CI on `v*` tags. The Windows NSIS and Linux AppImage/deb targets stay configured for local builds
  but are unsigned, untested, and never published — the README documents them as
  build-from-source with an "untested" warning. The private repository has no usable
  anonymous update feed, so desktop updates are manual.

There is intentionally **no heavy frontend build step**. Keep the renderer simple.

## Repo layout (target)

```
AiTM/
  AGENT.md            # this file
  SPEC.md             # product + technical spec
  package.json        # private Electron workspace root
  package-lock.json
  electron-builder.js   # build/sign/notarize config + GitHub publish
  .github/workflows/release.yml
  build/                # icon.icns/png, entitlements, render-icon helper (buildResources)
  src/
    main/             # main process
      index.js        # app bootstrap, window, menu, lifecycle
      runtime.js      # constructs the engine with Electron platform dependencies
      stream.js       # emitStream -> renderer 'ai:stream' events
      ipc/            # IPC handlers; validates all input
      keystore.js     # safeStorage-backed per-provider key vault
      ingest/         # native Electron folder/file pickers
    preload/
      index.js        # contextBridge API surface (+ ai.onStream)
  packages/
    engine/           # @oak-security/aitm-engine; CommonJS, no UI/platform imports
      src/
        index.js      # createEngine({ dataDir, keyStore, onEvent })
        application.js # command interface + full TRACE pipeline runner
        projects/     # file-based store + schema/migrations
        ingest/       # transport-neutral digest/walker
        ai/           # providers, prompts, schemas, orchestration
        report/       # Markdown/HTML/PDF assembly
        phases.js     # TRACE phase registry
    workbench/        # @oak-security/aitm-workbench; shared browser assets
      renderer/       # index.html, styles.css, app.js, assets/
    cli/              # @oak-security/aitm; no Electron dependency
      src/
        aitm.js       # explicit mode dispatcher
        runtime.js    # constructs engine with CLI key store + event sink
        tui/          # Ink/React frontend, ingestion and pipeline helpers
        server/       # loopback HTTP/SSE transport used by web/serve
      web/web-api.js  # browser fetch/SSE replacement for preload
      docs/           # mode-specific operating notes
  test/
    application.test.js # command/pipeline interface behavior with local fakes
    cli.test.js        # mode dispatch and headless CLI smoke coverage
    core.test.js      # schema migration, phase seeding, render, ingestion guards
    tui.test.js       # TUI runtime, target resolution, pipeline helpers
    webserver.test.js # host/origin guards, upload sanitizing, preload contract, e2e
    adapters.test.js  # Anthropic refusal/truncation/effort, model-table drift guard
```

## Core reuse invariant

`packages/engine/src/application.js` is the shared seam for project/settings/key
commands and pipeline execution. Electron IPC, HTTP RPC, the TUI phase adapter, and
the headless CLI must call it rather than reimplementing project mutations or phase
sequencing.

The stronger package boundary is deliberate: nothing under `packages/engine` or
`packages/cli` may import `electron`, and neither package may declare it as a
dependency. Construct an engine with `createEngine({ dataDir, keyStore, onEvent })`;
platform adapters own those capabilities. There are no module-loader shims. The
desktop adapter is the only code allowed to use `safeStorage`, native dialogs, or the
Electron app lifecycle. All modes still use one data directory by default, while the
non-Electron key file remains separate from the Electron vault.

## Build / run / test

(Define these scripts in `package.json` as you scaffold; agents should run them, not
invent ad-hoc commands.)

- `npm run dev` — Electron against the local workbench with devtools.
- `npm run tui` — `aitm tui`. `npm run gui` — Electron. `npm run web` — `aitm web`.
- `npm run aitm -- -p ...` — programmatic mode. `npm run server` — API-only
  `aitm serve` mode. Both run the shared application module outside Electron.
- `npm run check` — `node --check` over repository JavaScript. There is no linter;
  keep it as the syntax gate.
- `npm test` — `node --test` over `test/**/*.test.js` (ingestion and upload guards,
  schema migration, phase gating, clean engine loading, provider-adapter behaviour,
  the web host/origin guards, and an e2e pass over the web server).
- `npm run pack:check` — inspect the files in every publishable npm package.
- `npm run verify:release -- vX.Y.Z` — ensure every manifest, dependency, lockfile,
  and release tag carries the same version.
- `npm run dist` — build desktop installers via electron-builder.

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
   (`packages/cli/src/tui/keys.js`, `~/.config/aitm-tui/keys.json`) — plaintext at rest, protected by
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
     join, and digest in a temp dir that is always deleted (`packages/cli/src/server/ingest.js`).
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
7. Disable devtools and the reload/inspect menu items in production builds. If an
   update feed is added later, it must verify signatures.
8. No telemetry without an explicit, default-off opt-in.

## Branding (Oak Security)

Tokens live in `packages/workbench/renderer/styles.css` `:root`. Reference: https://github.com/oak-security/resources/tree/main/brand.

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

- **TRACE phases** live in `packages/engine/src/phases.js` as a registry. Each phase declares
  `id`, `title`, `required`, `defaultEnabled`, and `appliesWhen(classification)`.
  Required phases cannot be disabled. The workflow UI, auto-run, and report all derive
  from the project's enabled-phase set. See SPEC.md "Phase model".
- **AI provider adapters** (`packages/engine/src/ai/`) implement a common interface:
  `structuredCall({ model, name, schema, system, user, key, signal, onDelta, effort })`
  and `validateKey`. Both **OpenAI** (`/v1/responses`, JSON-schema strict) and
  **Anthropic** (Messages API, forced tool call) ship, selected via `settings.provider`
  through `getAdapter`. Both stream and call `onDelta` per chunk. `effort` maps to
  GPT-5 `reasoning.effort` and to Anthropic `output_config.effort`. Don't hard-code a
  provider at call sites; go through `orchestrate`.
- **Models**: the report and other synthesis steps use the *fast* model; STRIDE and
  coordination use the *deep* model. Both are per-provider, set in Settings. Defaults
  live in **three** places that must agree — `PROVIDERS` in
  `packages/workbench/renderer/app.js`, `MODEL_DEFAULTS` in
  `packages/cli/src/tui/tui/App.js`, and `DEFAULTS` in `packages/engine/src/settings.js`
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
