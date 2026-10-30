# Historical specification — AiTM · AI Threat Modeller (Oak Security edition)

This document records the former application. It is retained for design history,
not current installation or runtime instructions. Use [README.md](../README.md)
and [SPEC.md](../SPEC.md) for the current v2 implementation.

Status: v0.3, implemented · Owner: Stefan Beyer · Drafted 2026-06-18, revised 2026-08-31

Sections marked **(as built)** describe shipped behaviour and are the ones to trust when
they disagree with the surrounding design rationale, which is kept for context.

## 1. Purpose

A local-first application that runs the **TRACE** threat-modeling framework with heavy
AI assistance, **Oak Security**-branded, generalized beyond Web3, with the user
supplying their own AI API key. It began as a port of an internal Node/Express + vanilla-JS
web dashboard to a packaged desktop app. (Originally prototyped with Mostly Harmless
branding; now Oak.)

Product name: **AiTM** — "AI Threat Modeller". Bundle identifier `io.oaksecurity.aitm`.

## 2. Users and use cases

- Security engineers and consultants running design-level threat models offline or on
  sensitive material that should not transit a shared backend.
- Single-user, single-machine. No authentication, no accounts, no org gating, no
  multi-tenant server. The app trusts the local user. **This binds every UI and adapter**
  (see section 5): a hosted multi-tenant build was tried and removed.
- Primary flow: create project → set scope → ingest sources → AI-draft the TRACE
  model → review/correct → STRIDE → (optional) attack trees → (optional) coordination
  analysis → generate report → export PDF/JSON.

## 3. Scope and non-goals

In scope, **as built**:
- Electron desktop app, shipped for macOS (Windows and Linux are buildable from source
  but unsigned and untested — section 13), plus terminal and local-web UIs, a headless
  CLI, and an API-only server adapter over the same core (section 5).
- Oak Security branding and design system.
- User-provided **OpenAI and Anthropic** API keys, one per provider, encrypted
  on-device (Electron; see section 6 for the non-Electron frontends).
- Generic threat modeling with domain profiles (Web3 retained as one profile).
- Full TRACE phase workflow with per-project optional phases.
- Local file-based project store; JSON import/export; PDF report export.
- Source ingestion: a local source/project folder and/or individual local files
  (architecture/spec docs: md/txt/docx/pdf; source files). A project may hold
  **several sources** (e.g. a code folder plus a docs folder/files), which complement
  each other. The desktop app is local-only; the TUI and web frontends additionally
  shallow-clone a git URL (see the caveat in section 11).
- Streamed (SSE) provider calls with cancel; separate version-locked desktop and CLI
  release pipelines.

Non-goals:
- Repo-ZIP upload, and private-repo PAT ingestion.
- Cloud sync, collaboration, multi-user access, or a hosted backend. A hosted
  multi-tenant web build existed briefly and was removed; do not reintroduce one
  without revisiting section 2.
- Code audit / formal verification. This is design-level analysis only.

## 4. Framework decision: Electron

Chosen: **Electron**. Rationale: the source app's value is in its Node ingestion layer
(`simple-git`/clone hardening, `mammoth`, `pdf-parse`, `pdfkit`) and its
`/v1/responses` structured-output orchestration. Electron reuses ~90% of that code in
the main process and ~100% of the vanilla-JS renderer, giving the fastest path to a
working, secure build.

| Option | Reuse | Key storage | Bundle | Effort |
|---|---|---|---|---|
| **Electron (chosen)** | Node backend + JS frontend as-is | `safeStorage` (OS keychain) | ~150 MB | lowest |
| Tauri v2 + Node sidecar | backend via sidecar; frontend as-is | stronghold/keychain | ~40–60 MB | medium |
| Tauri v2 pure Rust | frontend only; backend rewritten | stronghold | ~10–15 MB | highest |

Cost accepted: larger bundle and higher memory than Tauri. If footprint becomes a
hard requirement later, the provider/ingestion modules are isolated enough to port to
a Tauri sidecar without touching the renderer.

## 5. Architecture

**(as built)** Three UIs and two programmatic adapters share the standalone
`@oak-security/aitm-engine` package. `packages/engine/src/application.js` is the
transport-neutral command and pipeline interface; project mutation, phase persistence,
optional-phase skipping, and automatic pipeline sequencing live there once. The engine
also owns the project store, phase registry, digest logic, provider adapters,
orchestration, and report assembly. It accepts its data directory, key store, and event
sink at construction and has no Electron dependency.

Electron IPC and the separately installed `@oak-security/aitm` CLI are adapters at that
seam. The desktop injects `safeStorage`, native dialogs, and its renderer event sink;
the CLI injects its mode-600 key store and terminal/SSE event sink. The shared static
workbench lives in `@oak-security/aitm-workbench` and is consumed by both the Electron
and local-web adapters. No module-loader shims are involved.

| Adapter | Entry | Interface | Notes |
| --- | --- | --- | --- |
| Desktop | `src/main/index.js` | Electron + workbench package | Native dialogs and OS-keychain vault |
| Terminal | `aitm tui` / `packages/cli/src/tui` | Ink/React | Git-URL ingestion and AI scope filter |
| Local web | `aitm web` | served workbench package | Browser pickers; loopback-bound, no auth |
| Programmatic | `aitm -p` | stdout/JSON | In-process; no HTTP server required |
| Server | `aitm serve` | HTTP + SSE | API-only; loopback-bound, no auth |

The top-level `aitm` command is only a dispatcher: each UI is an explicit startup mode.
A bare invocation prints usage rather than choosing a UI implicitly. The CLI package
does not contain or install Electron; `aitm gui` only launches a separately installed
desktop application.

All modes are single-user and read the same project store and `settings.json`. Keys
differ: Electron uses the OS keychain; every non-Electron mode shares `~/.config/aitm-tui/keys.json`
or the provider env vars.

The diagram below is the package and adapter model.

```
                ┌──── @oak-security/aitm-engine ────┐
                │ commands · store · ingest · AI   │
                │ phases · reports · cancellation  │
                └──────────────┬────────────────────┘
                               │ injected capabilities
              ┌────────────────┴────────────────┐
              │                                 │
   Electron desktop adapter          @oak-security/aitm CLI
   preload + IPC + safeStorage       TUI · web · -p · serve
              │                                 │
              └───────── workbench package ─────┘
                      Electron and web UI
```

- Renderer communicates only through the preload bridge. A thin `fetch`→`invoke`
  shim lets the ported `app.js` keep its original call sites with minimal edits.
- Every transport validates input before dispatch. The Electron main process is the
  desktop trust boundary; the CLI process is the trust boundary for non-Electron modes.

## 6. AI provider and key model

- **Adapter interface**: `{ id, label, validateKey(key),
  structuredCall({model, name, schema, system, user, key, signal, onDelta, effort}) }`.
- **Adapters (both ship)**: `OpenAIResponsesAdapter` (`POST /v1/responses`, JSON-schema
  strict; `effort`→`reasoning.effort` on GPT-5) and `AnthropicAdapter` (Messages API,
  forced tool call; `effort`→`output_config.effort`). Selected by `settings.provider`.
  Defaults — OpenAI: `gpt-5.6-terra` (fast) / `gpt-5.6-sol` (deep); Anthropic:
  `claude-sonnet-5` (fast) / `claude-opus-5` (deep). All overridable via Settings
  dropdowns. The report and other synthesis steps use the fast model;
  STRIDE/coordination use the deep model.
- **Streaming & cancel**: calls stream (SSE) with no wall-clock timeout; in-flight
  calls are cancellable (`AbortController` registry → `ai.cancel`). A status bar shows
  the stage and a live (approximate) token count, "thinking…" before output begins.
- **Key handling (per provider)**: keys are stored as an encrypted
  `{ openai, anthropic }` map in `userData/keystore.bin` via `safeStorage`. The renderer
  sets/clears/tests a key per provider and reads only `{ configured, last4 }` plus an
  in-session verified flag. Keys are injected into provider calls in the main process
  only. Settings has a provider selector with a provider-specific key + models block.
- **Key validation**: a lightweight ping call on Test (or first successful call) marks
  the provider's key verified; errors surfaced clearly (missing, invalid, network).
- **Privacy notice**: Settings states that source digests are sent to the selected
  provider on each AI call.

## 7. Phase model (TRACE)

TRACE phases (from the framework's `METHODOLOGY.md`):

| # | Phase | Required | Default | Applies when |
|---|---|---|---|---|
| 0 | Scope & Source Inventory | yes | on | always |
| 1 | Ingest Sources | yes | on | always |
| 2 | Construct TRACE Model | yes (gate) | on | always |
| 3 | STRIDE Identification & Ranking | yes (gate) | on | always |
| 4 | Build Attack Trees | no | on | important threats exist |
| 5 | Collusion & Coordination Inspection | no | off | classification flags coordinating actor groups (validators, multisigs, committees, DAOs, signer sets) |
| 6 | Roadmap & Report | yes | on | always |

Optionality requirements:
- Implemented as a **phase registry** (`packages/engine/src/phases.js`). Each entry:
  `{ id, title, required, defaultEnabled, appliesWhen(classification) }`.
- A project stores its **enabled-phase set**. Required phases (0,1,2,3,6) cannot be
  disabled. Optional phases (4,5 and any future ones) are user-toggleable; their
  default is seeded from `appliesWhen` against the project classification.
- The user's "pollution detection"-style example generalizes here: any phase not
  applicable to a given engagement is disabled and then excluded from the workflow
  nav, the auto-run sequence, and the final report. Disabling a phase mid-project
  warns if it already holds data.
- New optional phases can be added to the registry without code changes elsewhere.

Phase → existing AI endpoint mapping (reused, renamed for generality):
- P2 Construct TRACE Model ← `classify` + `system-model`
- P3 STRIDE ← `stride`
- P4 Attack Trees ← `attack-tree`
- P5 Coordination ← `collusion` (ABC-style overlay; supplemental to STRIDE)
- P6 Report ← `report`

Approval gates and the optional auto-run (auto-approve each gate, build trees for the
top-N suitable threats, skip gracefully when fewer exist) carry over from the source.

## 8. Generic threat modeling

Classification is generalized beyond Web3 via **domain profiles**. Each profile tunes
prompts, suggested asset/invariant/actor vocabularies, and which optional phases
default on.

Profiles (v1): Generic IT system, Web application / SaaS, Cloud / infrastructure,
Mobile application, Enterprise network, Data pipeline / ML system, IoT / embedded,
ICS / OT, and the retained Web3 profiles (DeFi protocol, L1, L2/rollup, bridge,
DAO/governance, oracle/keeper, wallet/custody, appchain/module). Profile is AI-proposed
at classification and user-overridable.

Terminology stays method-neutral: STRIDE-per-element is the core; coordination/ABC
analysis is the Web3-leaning optional overlay (P5).

## 9. Data model

Project state is plain, versioned JSON, stored as files (one project per file) under
`userData/projects/`, with a separate active-project pointer. JSON export/import is the
portability/backup mechanism (validates `schemaVersion`, normalizes missing fields,
re-IDs on import collision, refuses malformed files).

```jsonc
{
  "schemaVersion": 2,
  "project": { "id", "name", "createdAt", "updatedAt", "status", "notes" },
  "scope": { "boundaries", "inScope", "outOfScope", "assumptions", "sourceInventory" },
  "phasesEnabled": ["scope","ingest","trace-model","stride","attack-trees","report"],
  "classification": { "profile", "confidence", "rationale", "evidence", "userOverride" },
  "sources": [ { "id","type","ref","hash","summary","excerpts","warnings" } ],
  // type: "folder" | "files"; ref = absolute local path(s), an "upload:<name>" marker
  // for browser uploads, or the git URL for a cloned repo (which digests as "folder")
  "traceModel": {
    "protectedAssets", "threatActors", "roles", "invariants",
    "components", "trustBoundaries", "valueFlows", "edges", "openQuestions"
  },
  "strideThreats": [ { "id","componentId","surfaceId","category","title","scenario",
    "actorIds","assetIds","invariantIds","likelihood","impact","risk","rationale",
    "mitigations","tags","status" } ],
  "attackTrees": [ { "id","name","selectedThreatIds","nodes" } ],
  "coordination": { "enabled","matrices","scenarios","notes" },
  "report": { "latestSource","latestHtml","generatedAt" }
}
```

The API key is **never** part of this structure. Raw cloned repos are never persisted;
only digests/summaries/excerpts.

## 10. Application command and adapter surfaces

All handlers validate input and run in the main process.

Each `ai.*` command persists its result into the project and returns the updated project.
`pipeline.step` and `pipeline.run` expose the same shared sequencing used by `aitm -p`;
the interactive renderers may still call individual phases for approval gates.
Streaming progress arrives out-of-band via the Electron event or HTTP SSE adapter.

```
projects.list() / get(id) / create(input) / update(id, patch) / remove(id)
projects.export(id) -> json   |   projects.import(json) -> project
projects.reset(id) -> project   // clear AI-derived data; keep sources/scope/phases
projects.setActive(id) / getActive()

keystore.status() -> { encryptionAvailable, providers: { openai:{configured,last4}, anthropic:{...} } }
keystore.set(provider, key) / clear(provider) / test(provider)
keystore.validate(provider, key)

settings.get() / settings.set(patch)        // provider, modelFast, modelDeep, privacyAck

ingest.folder()  -> { canceled } | { source }            // native dir picker
ingest.files()   -> { canceled } | { sources, errors }   // native file picker
ingest.removeSource(projectId, sourceId) -> project
ingest.scopeFilter(digest, hint) -> filtered digest
// The desktop bridge is local-only. The web frontend exposes the same surface over
// HTTP (packages/cli/src/server/rpc.js) with browser pickers behind ingest.folder/files, and adds
// ingest.repo(url) for a git clone; the renderer feature-detects it. ZIP upload is
// not implemented in any frontend.

ai.classify(projectId) / traceModel / stride / coordination / report  -> project
ai.attackTree(projectId, { threatIds }) -> project   // one tree per new threat, accumulative
ai.cancel() -> { cancelled }
ai.onStream(cb)  // 'ai:stream' events: { event: start|progress|end|error, label, tokens, message }

pipeline.step(projectId, step, options) -> { step, status, project }
pipeline.run(projectId, {reset, attackTreeLimit}) -> { project, steps }

report.exportPdf(projectId) / exportMarkdown(projectId) -> { canceled } | { path }

phases.registry(classification) -> phase metadata (required/optional/defaultEnabled)
app.revealDataFolder()
```

## 11. Security model

See AGENT.md "Security invariants" for the binding list. Summary of the threat model
for the app itself:

- **Renderer compromise / malicious source content** → mitigated by context isolation,
  sandbox, strict CSP, no Node in renderer, IPC input validation.
- **Key exfiltration** → key never crosses the bridge in plaintext, never in exports
  or logs; `safeStorage` at rest; redacted hints only.
- **Local folder/file ingestion** → user-selected via native dialog or browser picker;
  confine the walk to the chosen root, do not follow symlinks escaping it, honor
  `.gitignore`, skip binaries, allowlist doc types (md/txt/docx/pdf), reject
  macro-enabled Office, and apply byte/file-count caps. Browser uploads are additionally
  path-sanitized (no absolute paths, no `..`, confinement re-checked after join) and
  materialized in a temp dir that is deleted after digesting.
- **Git-URL ingestion (TUI and web only)** → shallow clone, digest, delete. **The
  source app's SSRF/IP-allowlisting and DNS re-resolution guards were not carried
  over**, so the process will issue git requests to any host the caller names,
  including internal addresses. Accepted because the caller is the local operator in
  both frontends; it is the specific reason neither may be exposed to anyone else. Add
  those guards before any multi-user or network-reachable use. A leading `-` is
  rejected and `--` precedes the URL, so the argument cannot become a git option.
- **Deferred (ZIP upload)** → zip-slip/symlink/ratio/count/size guards, not wired.
- **Supply chain** → pin dependencies, audit on CI, minimize native modules, and
  require signed/notarized desktop artifacts.
- **Data exfiltration to AI provider** → explicit privacy notice; egress restricted to
  the configured provider host.

## 12. Design system (Oak Security)

- Palette: ink `#000`, workspace `#F7F6F5`, brand gold `#FFC965` → magenta `#9C0069`
  gradient (`--gradient`); severity high `#8a005d`, critical `#5b0019`.
- Typography: BDO Grotesk (400/500/700/800), vendored woff2.
- Buttons: primary is ink, hover morphs to the gradient; danger is magenta outline.
  Active nav is a solid white pill. Gradient accents on section rules, the status bar,
  and the active-nav badge. Tokens live in
  `packages/workbench/renderer/styles.css` `:root` (contained theme swap).
- The AiTM node-graph mark is the app logo (sidebar + window/dock icon). The Oak logo
  appears only as a "by Oak Security" lockup in the sidebar footer.
- Report PDF/HTML is Oak-branded but states it was prepared independently using Oak
  tooling, dependent on user input.

## 13. Packaging & distribution

- The Electron desktop and non-Electron CLI are separate products at the same version.
  The desktop never installs an `aitm` executable, and the CLI never installs Electron.
- `electron-builder`, **macOS Apple Silicon only as a shipped desktop artifact**:
  `.dmg`/`.zip` signed with a Developer ID and notarized, built explicitly for `arm64`
  and published as a non-draft GitHub Release by CI on a `v*` tag.
- GitHub Packages receives `@oak-security/aitm-engine`,
  `@oak-security/aitm-workbench`, and `@oak-security/aitm` for the same tag. The first
  two are implementation dependencies; operators install only `@oak-security/aitm`.
- The release gate runs syntax checks, the full test suite, package-content dry runs,
  and exact tag/manifest/internal-dependency/lockfile version validation. All signing
  and notarization secrets are mandatory before the desktop publish job starts.
- Windows (`nsis`) and Linux (`AppImage`, `deb`) targets remain in the config so a local
  build works, but they are unsigned, untested, and excluded from releases. They are
  documented in the README as build-from-source instructions carrying an explicit
  "untested" warning. Shipping them requires Authenticode signing plus actual testing on
  each platform first.
- Signing/notarization is required for macOS Gatekeeper. Desktop updates are manual
  while the repository is private because there is no anonymous update feed.
- `userData` holds keystore, projects, settings, logs. Provide a "reveal data folder"
  and a "reset all data" action.

## 14. Open questions

- Whether to ship optional local/offline inference for sensitive engagements.
- Whether to add a signed update feed if the repository or an artifact mirror becomes
  publicly readable.
- Whether to ship Windows/Linux binaries at all, which requires an Authenticode
  certificate and a tester on each platform.
- Private-repo (PAT) ingestion priority.
- Whether to carry the SSRF guards into git-URL ingestion (section 11) or keep that
  feature explicitly local-operator-only.
