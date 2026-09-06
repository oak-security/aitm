# AiTM — AI Threat Modeller

```text
    _    ___ _____ __  __
   / \  |_ _|_   _|  \/  |    o-----o
  / _ \  | |  | | | |\/| |    |\   /|
 / ___ \ | |  | | | |  | |    | o-o |
/_/   \_\___| |_| |_|  |_|    o-----o
```

A local server that runs the [TRACE methodology](https://github.com/oak-security/TRACE/blob/main/METHODOLOGY.md), with an API and a terminal client. By Oak Security.

AiTM v2 is a fresh implementation. The server owns source ingestion, project state,
AI calls, pipeline jobs, human reviews and reports. The TUI uses the HTTP API.
Closing a terminal does not stop the server or abandon an analysis.

## Install and launch

Node.js 22.3+ and Git are required. From this checkout:

```sh
npm ci
npm_config_prefix="$HOME/.local" npm link
aitm
```

Make sure `~/.local/bin` is on `PATH`. On a case-insensitive macOS filesystem,
`AITM` also launches the same command. `npm start` runs directly from the checkout.
A bare `aitm` opens the TUI and starts a local background server when needed.

```sh
aitm ./my-repo ./architecture.pdf --name "Release assessment" --scope "Custody and release authority"
aitm serve                              # foreground API server
aitm --server http://127.0.0.1:8790       # attach a TUI to a running engine
aitm --port 8791 --data-dir ./private-data
aitm status
aitm stop                               # stops background server; cancels active runs
```

`aitm serve` can be supervised by launchd, systemd or another process manager. The
server is single-user and binds only to loopback. It has no public hosting mode.
Use `--server` to explicitly attach to a different local server. Local paths refer
to the server's filesystem.

## Provide API keys

For this source checkout, run:

```sh
python3 scripts/configure-keys.py
```

Both prompts hide input. The script writes `.env.local` with mode 0600; Git ignores
it. Alternatively, `aitm configure` prompts privately and writes
`~/.config/aitm/keys.json` with mode 0600. These files are plaintext protected by OS
permissions, not encrypted vaults. Don't paste keys into chat, project notes or code.

The server loads keys in this order: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` environment
variables, `.env.local` in its working directory (then the installed package root),
and the private key file. Restart the server after changing keys. Only configuration
status reaches the API client; key values do not appear in projects, reports or logs.

For an Anthropic key that spans workspaces, also set `ANTHROPIC_WORKSPACE_ID=wrkspc_...`
in `.env.local` or the server environment. Workspace-bound keys do not need this setting.

Both providers ship. Fast/deep defaults are `gpt-5.6-terra` / `gpt-5.6-sol` and
`claude-sonnet-5` / `claude-opus-5`. STRIDE and coordination use the deep slot;
other phases use the fast slot. Choose a provider with `p`; press `e` on Scope to
edit models, reasoning effort, optional phases and tree count. `v` tests the selected
provider with a small real request. Availability depends on your provider account.

## Terminal workflow

1. Press `n` to name an assessment and define its scope.
2. Press `s` to add a folder, code/document file or public Git repository; repeat
   for complementary sources. `t` adds pasted notes or specifications.
3. Use `r` to run with review gates. Inspect the selected phase; `e` opens its JSON
   in `$VISUAL`, `$EDITOR`, or `vi`. `a` records reviewer identity and notes.
4. Press `r` again after approval to continue. `f` runs/resumes an end-to-end draft
   without marking any artifact as human-reviewed.
5. Press `x` to export Markdown, PDF or portable JSON. Export refuses to overwrite
   an existing file. Review and approval history appear in reports.

| Key                       | Action                                                                 |
| ------------------------- | ---------------------------------------------------------------------- |
| Up / Down                 | Select project or TRACE phase                                          |
| Enter                     | Open project / advance form                                            |
| `j` / `k`, Page Down / Up | Scroll artifact                                                        |
| `r`                       | Run/resume with review gates                                           |
| `f`                       | Run/resume a complete draft                                            |
| `F`                       | Restart a full draft after typing `RESTART`; clears generated analysis |
| `g`                       | Regenerate selected phase, enforcing upstream review gates             |
| `a` / `e`                 | Approve / edit selected artifact (Scope edits settings)                |
| `s` / `t`                 | Add path/repository / text notes                                       |
| `u`                       | Re-snapshot local and repository sources                               |
| `d`                       | Remove a numbered source after typing `DELETE`                         |
| `p` / `v`                 | Select provider / verify connection                                    |
| `c`                       | Cancel active job; completed phases are retained                       |
| `x`                       | Export report or project                                               |
| `i`                       | Import portable JSON from the project list                             |
| `l` / `?`                 | Run log / keyboard help                                                |
| `D`                       | Delete selected assessment from the project list after confirmation    |
| `R`                       | Refresh state                                                          |
| Esc / `q`                 | Return to projects / quit TUI                                          |

An assessment's review sequence is source inventory → TRACE model → ranked STRIDE
threats → enabled attack trees → applicable coordination findings → final report.
A draft run bypasses gates but all generated artifacts stay marked **DRAFT**.

Source changes invalidate all generated analysis and the inventory approval. Editing
an artifact invalidates its dependents and resets its own review. Changing analysis
settings clears generated analysis. Refreshing an unchanged source preserves results.
Edits use revision checks to avoid silently overwriting another client's changes.

## Inputs and limits

- Local folders/repositories and individual UTF-8 code, config, text, Markdown,
  HTML, CSV, JSON, YAML, and other readable text files.
- PDF and DOCX documents; scanned/image-only documents need OCR or a transcription.
- Public HTTPS repositories on GitHub, GitLab and Bitbucket. A shallow clone is
  pinned to a commit, snapshotted and deleted; no hooks or submodules are run.
  Use a local checkout for private repositories or other Git hosts.
- Inline text and file snapshots pushed over the API. A file snapshot may contain
  UTF-8 text or base64 PDF/DOCX data; replacing it invalidates dependent analysis.

Folder ingestion honors nested `.gitignore` rules and skips dependencies, generated
folders, credential filenames, symlinks and unsupported binaries. Caps are 8 MiB per
file, 32 MiB / 1,000 files per source, 100 sources / 2,000 files per project, 30,000 extracted
characters per file, 500,000 per source and 1,000,000 per project. Truncation and
extraction limitations are recorded. AI prompts use bounded excerpts distributed
across the sources, prioritizing architecture/specification documents (up to 180,000 source characters). Prefer focused architecture
and specification evidence over an entire monorepo.

Snapshots have file IDs, hashes and line references. Model claims need matching
source quotes or explicit assumptions. The engine validates object references,
STRIDE coverage of assets/invariants/edges, tree connectivity and roadmap links.
If a generated quote occurs exactly once in its cited file, the engine can correct
mistaken line numbers and records the correction in generation metadata. It never
fuzzy-matches invented quotes; ambiguous references still require correction.
Coverage links are computed from the threats' object references. Missing coverage
is explicitly flagged for review, and corrections are retained in generation metadata.
These checks establish traceability; they cannot establish whether an AI judgement
is correct. Source text is treated as evidence, never instructions.

## API and storage

The [API guide](docs/api.md) includes examples. The running server exposes
`GET /v1/openapi.json` with request schemas and artifact schemas; progress is SSE
with replay through `Last-Event-ID` or `?after=`. Jobs are independent of client
connections. Restarting after a crash marks unfinished runs `interrupted`; resume
retries the unfinished phase using saved artifacts.

State defaults to `~/.local/share/aitm-v2` (`AITM_DATA_DIR` / `--data-dir` override).
Each project is an atomic JSON document with source snapshots, artifacts, jobs,
usage and review history. A process lock prevents multiple writers. The directory
uses mode 0700, project files 0600. v2 does not read or modify the old desktop store.
JSON imports create a new project ID, use portable snapshots and require fresh reviews.

```sh
aitm export PROJECT_ID --format markdown --output report.md
aitm export PROJECT_ID --format pdf --output report.pdf
aitm export PROJECT_ID --format json --output project.json
```

## Development and verification

```sh
npm run check
npm test
npm run pack:check
npm run test:live
```

Automated tests cover engine sequencing and review gates, HTTP/SSE lifecycle,
provider wire formats and failure modes, ingestion guards, evidence validation,
persistence, exports, and interactive TUI actions against the real HTTP server.
They use deterministic providers and do not spend API credit.

`test:live` requires real keys, verifies both providers, then runs the full pipeline
for each and exports evidence to ignored `artifacts/live-*`. It fails rather than
substituting fixtures if a provider is unavailable. By default it uses the explicitly
synthetic [custody example](examples/custody-architecture.md). Override the source:

```sh
AITM_LIVE_SOURCE=/absolute/path/to/whitepaper.pdf npm run test:live
AITM_LIVE_PROVIDER=openai AITM_LIVE_SOURCE=https://github.com/org/repo npm run test:live
```

To resume a failed live check without repeating completed phases, set
`AITM_LIVE_DIR=artifacts/live-<timestamp>` along with `AITM_LIVE_PROVIDER` and rerun.
The saved source snapshots remain the evidence for that assessment.

See [SPEC.md](SPEC.md) for the engine contract and [original-spec.md](docs/original-spec.md)
for historical context. The former desktop and browser applications are preserved
in Git history, not part of this runtime.
