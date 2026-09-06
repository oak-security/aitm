# Agent guide — AiTM v2

The user's current direction is a reusable engine with terminal and web interfaces and an API in one process. This guide
replaces the former desktop/multi-adapter conventions. See SPEC.md and the historical
specification at docs/original-spec.md.

## Architecture

- One Node.js 22+ ESM package. `src/engine` owns all domain state, phases, ingestion,
  providers, evidence validation and reports. It never imports the API or TUI.
- `src/api/server.js` is the versioned HTTP/SSE transport. Validate every request.
- `src/web` is a browser client of the API, with no duplicate domain engine.
- `src/tui` calls the engine directly and subscribes to its change events. The API
  exposes that same engine to the browser and external clients; `src/client.js` is for those clients.
- `src/cli.js` starts one process with an engine, API and TUI. No detached daemon,
  attachment handshake, HTTP polling or duplicate engine in the TUI. Quit closes
  the application, cancelling unfinished work and preserving completed artifacts.
  `aitm web [source]` opens the browser; `--no-open` leaves browser launch to the user.
  Closing a browser tab keeps the owning engine process and its jobs running.
- Both interfaces start with a project chooser. Never import the current directory
  implicitly. Create/open named projects and add multiple sources through import
  dialogs: public HTTPS URLs, documents and repository ZIPs. The TUI has a file
  browser with multi-file selection. An optional explicit CLI source remains a
  shortcut; `--project ID` reopens a saved project without ingestion.
- Imports are atomic per batch. Replacement preserves the selected source's ID and
  position; failures preserve existing sources and analysis. Switching projects
  must not cancel running work. Archive extraction is bounded and validates paths,
  rejects encrypted/special entries and skips symlinks before writing private files.
- Phase metadata and artifact schemas live once in `src/engine/schema.js` and are
  exposed by the API for clients. No separate provider model tables in the TUI.

## Required checks

Run `npm run check`, `npm test`, `npm run test:web` and `npm run pack:check` before
claiming completion. Install Chromium for browser tests with `npx playwright install chromium`.
`npm run test:live` runs real provider pipelines when keys are available; do not
claim live tests passed based on fake-provider tests. Keep test output and actual
limitations distinct. Verify terminal behavior in a PTY and visually inspect PDF
exports when changing presentation.

## Invariants

- Single-user, loopback only. Validate Host/Origin/fetch metadata. No public server,
  multi-tenant mode, telemetry or Electron. The web UI is served by the same local API.
- Private credentials only in environment, private `.env.local`, or mode-600 key
  file. Never print keys or write them into project state, reports, errors or logs.
  Settings key entry must be masked. Save atomically before changing active keys;
  retain redaction of retired keys for in-flight requests. Saved replacements take
  precedence over environment values. Provider/model pickers use the engine catalog
  and save together only after the final selection; Escape must preserve analysis.
- Ingestion is bounded, ignores secrets/dependencies and symlinks, honors nested
  gitignore, validates uploaded paths, and never executes source code or Git hooks.
  Preserve accepted text in full. Classification uses the inventory; TRACE model
  construction reads every source batch sequentially, retaining earlier findings.
  Downstream phases consume completed artifacts. Recheck automatic coordination
  applicability against model actors/roles. Never publish partial batch results.
- API clients cannot write project files directly. Jobs survive HTTP client disconnects while the engine remains open.
  Cancellation never publishes a partial artifact. Crash recovery marks interruption.
- Every output is a draft until an explicit human review. Draft runs may bypass gates
  without creating approvals. Upstream changes invalidate downstream artifacts.
- Reviewer names are optional. UI approvals ask only for optional notes; preserve
  timestamps, revision checks and sequential review gates.
- The command filename is lowercase `aitm`. Completed TUI projects open on the phase
  menu; `v` opens the report and Escape returns. Never replace navigation with a
  report automatically. Web full-pipeline controls remain visible across views.
- Accumulate keyed findings across source batches in the engine, retaining omitted
  prior items and validating the merged result. Show batch counts throughout
  streaming; never retry or fail merely because a later batch omitted an earlier item.
- Validate evidence quotes, references, coverage, tree structure and roadmap links.
- A citation mismatch must not abort otherwise valid TRACE analysis or trigger a
  paid regeneration. Retain the claim as an unverified assumption with review notes.
  Constrain generated cross-phase IDs to canonical model collections. Repair only
  unambiguous identity matches; unresolved optional links become review notes.
  Keep rejected citations/links in diagnostic metadata; never display them as verified
  evidence. Structural validation and sequential phase prerequisites still apply.
- Use protected assets, never crown jewels. TRACE means Threat actors, Roles, Assets,
  Critical invariants and Edges. It applies to protocols, systems and organisations.
- Oak palette: gold #FFC965 and magenta #9C0069. The ASCII identity includes the AiTM
  node graph. PDF exports use bundled BDO Grotesk. Reports state that AiTM generated
  them using AI and Oak Security did not author, review or endorse them. Do not
  hard-code personal authorship. `v` views Markdown without exports; PDF requires
  an explicit `x` export choice. Show storage location in Help.

Keep modules small and domain logic in the engine. Do not add alternate runtimes or
reuse the old application behind wrappers. Never send user source material to a
provider during automated tests; live testing is a separate explicit command.
