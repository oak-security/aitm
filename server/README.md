# aitm-web

Multi-tenant web frontend for AiTM. Serves the desktop app's renderer in the browser
(the Electron preload is replaced by `web/web-api.js` over HTTP + SSE) with the same
TRACE pipeline running server-side. Modeled on Hive's `serve-mt`.

## Tenancy and auth

- **GitHub OAuth**, gated on membership of `AITM_ALLOWED_ORGS` (default `oak-security`;
  `read:org` scope so private membership counts) or an `AITM_ALLOWED_USERS` allowlist.
- **Sessions** are opaque random ids held in memory (7-day TTL, `HttpOnly SameSite=Lax`
  cookie, `Secure` on HTTPS). A restart signs everyone out.
- **Isolation is physical**: each GitHub identity gets its own data dir
  (`<data>/users/gh-<id>/`) holding projects, settings, and provider keys. The core
  store runs inside an `AsyncLocalStorage` tenant context per request, so there is no
  shared store to guard and no cross-tenant object references.
- **OpenAI-only, shared key**: the hosted build has no Settings screen. The server
  forces provider `openai` and the models (`AITM_MODEL_FAST`/`AITM_MODEL_DEEP`, default
  `gpt-5-mini`/`gpt-5.5`) and uses a single `OPENAI_API_KEY` from the environment for
  every user. Per-user limits (`AITM_MAX_CONCURRENT_AI`, default 2;
  `AITM_MAX_AI_PER_DAY`, default unlimited) protect that shared key, and cancel only
  aborts the caller's own in-flight AI calls. (The per-user encrypted keystore still
  exists in the core but is not exposed by the web UI.)
- **CSRF**: mutating requests must present a same-origin `Origin`/`Referer`
  (disabled in bypass mode so curl works). Strict CSP on all pages.

## Local testing (auth bypass)

```sh
npm install                      # repo root, once
AITM_AUTH_BYPASS=1 node server/src/main.js
# → http://localhost:8790 as user local:dev, no GitHub required
```

Bypass refuses to start when `AITM_WEB_BASE_URL` is not localhost.

## Ingestion in the browser

"Add folder" uploads a directory picked via the browser (filtered client-side to the
digest's text extensions, vendored dirs skipped, 96 MB cap), "Add file" uploads
documents/sources, and "Add repository" shallow-clones a git URL server-side. Uploads
are materialized in a temp dir, digested, and deleted — only digests persist. Report
export streams the Markdown/PDF as a download.

## Deploy (Hetzner VPS)

1. Create the GitHub OAuth app (org-owned): homepage `https://aitm.oaksecurity.io`,
   callback `https://aitm.oaksecurity.io/auth/github/callback`.
2. On the VPS (Ubuntu 24.04): install Node ≥ 20 and Caddy, then:

```sh
sudo useradd -r -m -d /var/lib/aitm-web -s /usr/sbin/nologin aitm
sudo rsync -a --exclude node_modules --exclude .git ./ /opt/aitm/
cd /opt/aitm && sudo npm install --omit=dev --no-audit
sudo mkdir -p /etc/aitm-web && sudo cp server/deploy/env.example /etc/aitm-web/env
sudo chmod 600 /etc/aitm-web/env && sudo $EDITOR /etc/aitm-web/env   # fill in secrets
sudo cp server/deploy/aitm-web.service /etc/systemd/system/
sudo cp server/deploy/Caddyfile /etc/caddy/Caddyfile                 # adjust domain
sudo systemctl daemon-reload && sudo systemctl enable --now aitm-web caddy
curl -s localhost:8790/api/healthz                                   # {"ok":true}
```

The unit binds 127.0.0.1:8790; Caddy terminates TLS (`tls internal` behind Cloudflare
"Full", or remove it for direct Let's Encrypt). SSE needs `flush_interval -1` (in the
shipped Caddyfile). Ops: `journalctl -u aitm-web -f`; data in `/var/lib/aitm-web`.

## API surface

`POST /api/rpc {channel, payload}` mirrors the desktop IPC channels (projects.*,
keystore.*, settings.*, phases.registry, ingest.removeSource, ai.*). Extras:
`POST /api/ingest/{files,folder,repo}`, `GET /api/report/{md,pdf}?projectId=`,
`GET /api/stream` (SSE: `{event, label, tokens, message}`), `GET /api/healthz`,
`/auth/{me,config,github,github/callback,logout}`.
