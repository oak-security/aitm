# Contributing

## Setup

```sh
nvm use            # Node.js 22, the minimum supported version
npm ci
npm run check      # syntax and formatting
npm test           # engine, API, provider protocol, TUI and CLI tests
npm run test:web   # browser tests
npm run pack:check # package contents
```

Browser tests need Chromium: run `npx playwright install chromium` one time. To
use an installed Google Chrome instead, set `AITM_BROWSER_CHANNEL=chrome`.

The automated tests use deterministic providers and spend no API credit.
`npm run test:live` runs the full pipeline against real providers and needs keys.
It writes evidence to the ignored `artifacts/live-*` directory. Do not report a
live result from the fake-provider tests.

```sh
AITM_LIVE_PROVIDER=anthropic npm run test:live
AITM_LIVE_SOURCE=/absolute/path/to/whitepaper.pdf npm run test:live
```

Run `npm run format` before you commit. CI runs the checks on Node.js 22, 24 and
26, on Linux and macOS.

## Layout

- `src/engine`: domain state, phases, ingestion, providers, evidence validation
  and reports. It never imports the API or an interface.
- `src/api/server.js`: the versioned HTTP and SSE transport. Validate each request.
- `src/web`: a browser client of the API. No build step, no second engine.
- `src/tui`: calls the engine directly and subscribes to its change events.
- `src/cli.js`: starts one process with the engine, the API and one interface.
- `src/token.js`, `src/config.js`: the access token and credential files.
- Phase metadata, artifact schemas, model defaults and the model catalog live once
  in `src/engine/schema.js`.

## Invariants

Changes must keep these properties. Add a test when you touch one of them.

**Access**

- Single-user, loopback only. No public server, multi-tenant mode or telemetry.
- Each API route needs the access token, except `/v1/health` and the static
  workbench files. Keep the Host, Origin and fetch-metadata checks.
- Keys live only in the environment, a private `.env.local`, or the mode-600 key
  file. Never print a key or write one into project state, reports, errors or
  logs. Key entry is masked. Save atomically before you change the active key.

**Ingestion**

- Bounded. Skip secrets, dependencies and symlinks. Honor nested `.gitignore`.
  Validate uploaded paths. Never execute source code or Git hooks.
- Keep accepted text in full. Never import the current directory implicitly.
- Imports are atomic per batch. A failed import leaves sources and analysis as
  they were.

**Pipeline**

- Each output is a draft until an explicit human review. Upstream changes
  invalidate downstream artifacts.
- TRACE model construction reads each source batch in sequence and keeps earlier
  findings. Never publish a partial batch result. Cancellation never publishes a
  partial artifact.
- Validate evidence quotes, references, coverage, tree structure and roadmap
  links. A citation mismatch becomes a review note; it does not stop the run or
  start a paid regeneration.
- Jobs continue when an HTTP client disconnects. A restart marks unfinished jobs
  as interrupted.

**Interfaces**

- The two interfaces start with a project chooser, or with Settings when no key
  is configured. Settings is reachable without an open project.
- The command name is lowercase `aitm`. Quit closes the whole application.
- Reports carry no personal author name and state that Oak Security did not
  author, review or endorse them.

See [SPEC.md](SPEC.md) for the full engine contract.

## Releases

A release goes to GitHub and to npm as `@oaksecurity/aitm`. You need write access
to this repository, and an npm account with 2FA that has publish rights in the
npm organization `oaksecurity`.

1. Set the version with `npm version X.Y.Z --no-git-tag-version`. Add a section
   to [CHANGELOG.md](CHANGELOG.md) and change the version in the examples of the
   [README](README.md). The CLI and API read the version from `package.json`.
2. Run all checks, then `npm run test:live` for the two providers.
3. Push the commit to `main` and wait until the `verify` workflow passes.
4. Run `npm pack`. Tag the commit `vX.Y.Z`, push the tag, and create a GitHub
   release with `oaksecurity-aitm-X.Y.Z.tgz` attached.
5. Publish the same file: `npm publish ./oaksecurity-aitm-X.Y.Z.tgz`. npm asks
   for your second factor. `publishConfig` in `package.json` sets public access.
6. Make sure that `npm view @oaksecurity/aitm version` shows the new version.

A release is permanent. npm does not accept the same version number a second
time, and the repository rules refuse changes to a `v*` tag. Correct a bad
release with a new version. If a version is dangerous to use, mark it with
`npm deprecate`.

Repository rules that apply to each contributor: `main` refuses force pushes and
deletion, GitHub secret scanning and push protection are on, and workflow runs
from forks wait for the approval of a maintainer.
