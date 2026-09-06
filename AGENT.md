# Agent guide — AiTM v2

The user's current direction is a clean server engine plus API and TUI. This guide
replaces the former desktop/multi-adapter conventions. See SPEC.md and the historical
specification at docs/original-spec.md.

## Architecture

- One Node.js 22+ ESM package. `src/engine` owns all domain state, phases, ingestion,
  providers, evidence validation and reports. It never imports the API or TUI.
- `src/api/server.js` is the versioned HTTP/SSE transport. Validate every request.
- `src/client.js` and `src/tui` communicate only through the HTTP API. Do not import
  engine, store, config or provider modules into the TUI.
- `src/cli.js` manages startup/attachment and the installed `aitm` command. The server
  remains running when a terminal closes. Only server startup loads provider keys.
- Phase metadata and artifact schemas live once in `src/engine/schema.js` and are
  exposed by the API for clients. No separate provider model tables in the TUI.

## Required checks

Run `npm run check`, `npm test` and `npm run pack:check` before claiming completion.
`npm run test:live` runs real provider pipelines when keys are available; do not
claim live tests passed based on fake-provider tests. Keep test output and actual
limitations distinct. Verify terminal behavior in a PTY and visually inspect PDF
exports when changing presentation.

## Invariants

- Single-user, loopback only. Validate Host/Origin/fetch metadata. No public server,
  multi-tenant mode, telemetry, Electron or web frontend in this iteration.
- Private credentials only in environment, private `.env.local`, or mode-600 key
  file. Never print keys or write them into project state, reports, errors or logs.
- Ingestion is bounded, ignores secrets/dependencies and symlinks, honors nested
  gitignore, validates uploaded paths, and never executes source code or Git hooks.
- API clients cannot write project files directly. Jobs survive client disconnects.
  Cancellation never publishes a partial artifact. Crash recovery marks interruption.
- Every output is a draft until an explicit human review. Draft runs may bypass gates
  without creating approvals. Upstream changes invalidate downstream artifacts.
- Validate evidence quotes, references, coverage, tree structure and roadmap links.
- Use protected assets, never crown jewels. TRACE means Threat actors, Roles, Assets,
  Critical invariants and Edges. It applies to protocols, systems and organisations.
- Oak palette: gold #FFC965 and magenta #9C0069. The ASCII identity includes the AiTM
  node graph. Reports use bundled BDO Grotesk and state independent preparation;
  do not imply that Oak Security authored or endorsed an assessment.

Keep modules small and domain logic in the engine. Do not add alternate runtimes or
reuse the old application behind wrappers. Never send user source material to a
provider during automated tests; live testing is a separate explicit command.
