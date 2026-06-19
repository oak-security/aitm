# Specification — AiTM · AI Threat Modeller (Oak Security edition)

Status: draft v0.1 · Owner: Stefan Beyer · Date: 2026-06-18

## 1. Purpose

A local-first desktop application that runs the **TRACE** threat-modeling framework
with heavy AI assistance. It ports the existing web app
(`/Users/stefanbeyer/Documents/bot-runs/thread-model-dashboard`) to a packaged desktop
app, **Oak Security**-branded, generalized beyond Web3, with the user supplying their
own AI API key. (Originally prototyped with Mostly Harmless branding; now Oak.)

Product name: **AiTM** — "AI Threat Modeller". Bundle identifier and display name use
this; finalize the reverse-DNS bundle id before first build.

## 2. Users and use cases

- Security engineers and consultants running design-level threat models offline or on
  sensitive material that should not transit a shared backend.
- Single-user, single-machine. No authentication, no accounts, no org gating, no
  multi-tenant server. The app trusts the local user.
- Primary flow: create project → set scope → ingest sources → AI-draft the TRACE
  model → review/correct → STRIDE → (optional) attack trees → (optional) coordination
  analysis → generate report → export PDF/JSON.

## 3. Scope and non-goals

In scope (v1):
- Electron desktop app for macOS, Windows, Linux.
- Oak Security branding and design system.
- User-provided OpenAI API key, encrypted on-device. Provider abstraction for later.
- Generic threat modeling with domain profiles (Web3 retained as one profile).
- Full TRACE phase workflow with per-project optional phases.
- Local file-based project store; JSON import/export; PDF report export.
- Source ingestion: **local only** — a local source/project folder and/or individual
  local files (architecture/spec docs: md/txt/docx/pdf; source files). A project may
  hold **several sources** (e.g. a code folder plus a docs folder/files), which
  complement each other.

Implemented since the original draft: OpenAI **and** Anthropic providers ship, calls
stream (SSE) with cancel, keys are stored per provider, and a CI release workflow +
electron-updater are wired.

Non-goals (v1):
- Remote ingestion: GitHub-repo clone and repo-ZIP upload (deferred; design hooks and
  the existing hardening from the source app are kept for v1.1).
- Private-repo PAT ingestion (with GitHub ingestion, v1.1).
- Cloud sync, collaboration, or a hosted backend.
- Code audit / formal verification. This is design-level analysis only.
- Auto-update infrastructure (optional, can land post-v1).

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

```
┌─────────────────────────── Electron app ───────────────────────────┐
│ Renderer (untrusted)            Preload (bridge)     Main (trusted)  │
│  index.html / styles.css   ──▶  window.api.* via  ──▶ IPC handlers   │
│  app.js (workbench)             contextBridge        ├ keystore      │
│  Oak assets, BDO Grotesk        (typed, no Node)     ├ projects (fs) │
│                                                      ├ ingest/*      │
│                                                      ├ ai/adapters   │
│                                                      ├ report+pdf    │
│                                                      └ phases registry│
└─────────────────────────────────────────────────────────────────────┘
        │ TLS egress only to configured AI provider (OpenAI)
        ▼
   provider API (/v1/responses)
```

- Renderer communicates only through the preload bridge. A thin `fetch`→`invoke`
  shim lets the ported `app.js` keep its original call sites with minimal edits.
- Main process is the sole trust boundary; it validates all input, holds the key,
  performs all I/O and network calls.

## 6. AI provider and key model

- **Adapter interface**: `{ id, label, validateKey(key),
  structuredCall({model, name, schema, system, user, key, signal, onDelta, effort}) }`.
- **Adapters (both ship)**: `OpenAIResponsesAdapter` (`POST /v1/responses`, JSON-schema
  strict; `effort`→`reasoning.effort` on GPT-5) and `AnthropicAdapter` (Messages API,
  forced tool call). Selected by `settings.provider`. Defaults — OpenAI: `gpt-5-mini`
  (fast) / `gpt-5.5` (deep); Anthropic: `claude-sonnet-4-6` (fast) / `claude-opus-4-8`
  (deep). All overridable via Settings dropdowns. The report and other synthesis steps
  use the fast model; STRIDE/coordination use the deep model.
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
- Implemented as a **phase registry** (`src/main/phases.js`). Each entry:
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
  // type: "folder" | "files"  (v1.1: "github" | "zip"); ref = absolute local path(s)
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

## 10. IPC API surface (preload bridge)

All handlers validate input and run in the main process.

Each `ai.*` call persists its result into the project and returns the updated project.
The full pipeline (re-run reset + sequencing) is orchestrated in the renderer, not a
single IPC call. Streaming progress arrives out-of-band via the `ai:stream` event.

```
projects.list() / get(id) / create(input) / update(id, patch) / remove(id)
projects.export(id) -> json   |   projects.import(json) -> project
projects.reset(id) -> project   // clear AI-derived data; keep sources/scope/phases
projects.setActive(id) / getActive()

keystore.status() -> { encryptionAvailable, providers: { openai:{configured,last4}, anthropic:{...} } }
keystore.set(provider, key) / clear(provider) / test(provider)

settings.get() / settings.set(patch)        // provider, modelFast, modelDeep, privacyAck

ingest.folder()  -> { canceled } | { source }            // native dir picker
ingest.files()   -> { canceled } | { sources, errors }   // native file picker
ingest.removeSource(projectId, sourceId) -> project
// v1 is local-only; ingest.github / ingest.upload(zip) are deferred to v1.1.

ai.classify(projectId) / traceModel / stride / coordination / report  -> project
ai.attackTree(projectId, { threatIds }) -> project   // one tree per new threat, accumulative
ai.cancel() -> { cancelled }
ai.onStream(cb)  // 'ai:stream' events: { event: start|progress|end|error, label, tokens, message }

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
- **Local folder/file ingestion** → user-selected via native dialog (no network/SSRF
  surface in v1); confine the walk to the chosen root, do not follow symlinks escaping
  it, honor `.gitignore`, skip binaries, allowlist doc types (md/txt/docx/pdf), reject
  macro-enabled Office, and apply byte/file-count caps.
- **Deferred (v1.1 remote ingestion)** → SSRF/IP allowlisting + DNS re-resolution for
  git clone and zip-slip/symlink/ratio/count/size guards for ZIP. Code retained from
  the source app, not wired in v1.
- **Supply chain** → pin dependencies, audit on CI, minimize native modules, verify
  update signatures if auto-update is enabled.
- **Data exfiltration to AI provider** → explicit privacy notice; egress restricted to
  the configured provider host.

## 12. Design system (Oak Security)

- Palette: ink `#000`, workspace `#F7F6F5`, brand gold `#FFC965` → magenta `#9C0069`
  gradient (`--gradient`); severity high `#8a005d`, critical `#5b0019`.
- Typography: BDO Grotesk (400/500/700/800), vendored woff2.
- Buttons: primary is ink, hover morphs to the gradient; danger is magenta outline.
  Active nav is a solid white pill. Gradient accents on section rules, the status bar,
  and the active-nav badge. Tokens live in `styles.css` `:root` (contained theme swap).
- The AiTM node-graph mark is the app logo (sidebar + window/dock icon). The Oak logo
  appears only as a "by Oak Security" lockup in the sidebar footer.
- Report PDF/HTML is Oak-branded but states it was prepared independently using Oak
  tooling, dependent on user input.

## 13. Packaging & distribution

- `electron-builder`: macOS `.dmg`/`.zip` (Developer ID + notarization), Windows
  `.exe`/`.msi` (Authenticode), Linux `AppImage` + `.deb`.
- Signing/notarization is required for macOS Gatekeeper and to avoid SmartScreen
  warnings on Windows; flag credential setup as a prerequisite before first public
  build.
- `userData` holds keystore, projects, settings, logs. Provide a "reveal data folder"
  and a "reset all data" action.

## 14. Open questions

- Final product name and bundle identifier.
- Whether to ship optional local/offline inference in v1.1 for sensitive engagements.
- Auto-update channel (defer unless required for distribution).
- Private-repo (PAT) ingestion priority.
