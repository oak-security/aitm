# AiTM web and server adapters

Local web frontend for AiTM. Serves the desktop app's renderer in the browser (the
Electron preload is replaced by `web/web-api.js` over HTTP + SSE) with the same TRACE
pipeline running in the Node process behind it.

Both modes are single user, with no authentication, accounts, or tenancy, and bind to
loopback by default. `aitm web` is the browser frontend; `aitm serve` exposes the same
application command interface without serving any UI.

## Run

```sh
npm install            # repo root, once
npm run web            # aitm web; UI + API at http://localhost:8790
npm run server         # aitm serve; API only at http://localhost:8790
```

| Environment variable | Meaning |
| --- | --- |
| `AITM_WEB_PORT` | listen port (default `8790`) |
| `AITM_WEB_HOST` | bind address (default `127.0.0.1`) |
| `AITM_WEB_ALLOWED_HOSTS` | comma list of extra hostnames the server answers to |
| `AITM_DATA_DIR` | project store location (default: the desktop app's data dir) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | provider keys, if you'd rather not store them |

API-only mode uses the corresponding `AITM_SERVER_PORT`, `AITM_SERVER_HOST`, and
`AITM_SERVER_ALLOWED_HOSTS` variables. Command-line `--port`, `--host`, and
`--allowed-hosts` options override them in either mode.

**There is no authentication.** Anyone who can reach the port has full access to your
projects, your provider keys, and your API spend. Keep the bind address on loopback
(the server warns if you change it) and reach it from other machines over something that
does the authenticating for you.

The server refuses any request whose `Host` is not loopback or in
`AITM_WEB_ALLOWED_HOSTS`, so a DNS-rebinding page pointed at the port gets a 403 rather
than an app. That also means reaching it by any other name, directly or through a proxy,
needs that name allowlisted.

### Over Tailscale

`tailscale serve` keeps the app on loopback and terminates TLS in tailscaled, so nothing
is exposed beyond your tailnet (this is `serve`, not `funnel`):

```sh
AITM_WEB_ALLOWED_HOSTS=$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")') npm run web
sudo tailscale serve --bg --https=443 http://127.0.0.1:8790
# → https://<host>.<tailnet>.ts.net/ ; `tailscale serve status`, `tailscale serve reset`
```

### Over SSH

```sh
ssh -L 8790:localhost:8790 host    # then http://localhost:8790, no allowlist needed
```

## Shared state with the desktop app and the TUI

- **Projects and settings**: `~/.config/AiTM` on Linux, `~/Library/Application Support/AiTM`
  on macOS, `%APPDATA%\AiTM` on Windows. Anything created here opens in the desktop app
  and in `aitm-tui`, and vice versa.
- **API keys**: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, else the shared non-Electron key
  file at `~/.config/aitm-tui/keys.json` (mode 600, `AITM_TUI_CONFIG_DIR` overrides) —
  the same store `aitm-tui` uses. The desktop app's OS-keychain vault stays Electron-only,
  so a key saved in the desktop app is not visible here and vice versa.
- Both providers and both model tiers are user-selectable from the in-app **Settings**
  screen, as on the desktop.

## Ingestion in the browser

"Add folder" uploads a directory picked via the browser (filtered client-side to the
digest's text extensions, vendored dirs skipped, 96 MB cap), "Add file" uploads
documents/sources, and "Add repository" shallow-clones a git URL. Uploads are
materialized in a temp dir, digested, and deleted, so only digests persist. Report export
streams the Markdown/PDF as a download.

Note that repository ingestion clones whatever URL you give it from inside this process,
with no host allowlist. That is the same trust model as the TUI (you are the only caller),
but it means the feature is not safe to expose to anyone else — see the bind-address
warning above.

## How it loads the core

`src/shim.js` installs a `Module._load` hook that fakes the three Electron touchpoints
(`electron`'s `app.getPath`, `keystore.js`, `stream.js`) before any of `src/main/*` is
required, the same approach as `tui/src/shim.js`. See AGENT.md "Core reuse invariant".

## API surface

`POST /api/rpc {channel, payload}` adapts the shared application commands
(`projects.*`, `keystore.*`, `settings.*`, `phases.registry`, `ingest.removeSource`,
`ai.*`, `pipeline.step`, `pipeline.run`) minus the ones that need a native dialog.
`GET /api/commands` returns the available command names. Extras:
`POST /api/ingest/{files,folder,repo}`,
`GET /api/report/{md,pdf}?projectId=`, `GET /api/stream` (SSE:
`{event, label, tokens, message}`), `GET /api/healthz`.

Mutating requests must carry a loopback `Origin`/`Referer` if they carry one at all, so a
page on another origin (including a DNS-rebinding host aimed at this port) cannot drive
the API from a browser. Requests with neither header (curl, scripts) are allowed: with no
session cookie there is no ambient credential for a browser to be tricked into replaying.
