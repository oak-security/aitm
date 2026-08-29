#!/usr/bin/env node
// Legacy aitm-web entry. The unified equivalent is `aitm web`. Single-user, no
// authentication: it serves the desktop renderer in the browser against the same
// project store all other modes use. Config via environment:
//   AITM_WEB_PORT           listen port (default 8790)
//   AITM_WEB_HOST           bind address (default 127.0.0.1)
//   AITM_WEB_ALLOWED_HOSTS  comma list of extra hostnames this server answers to,
//                           beyond loopback (e.g. a Tailscale MagicDNS name). Needed
//                           when reaching it by any name other than localhost, whether
//                           bound directly or fronted by a proxy such as
//                           `tailscale serve`.
//   AITM_DATA_DIR           project store location (default: the desktop app's data dir)
// API keys come from OPENAI_API_KEY / ANTHROPIC_API_KEY or the shared non-Electron key
// file (~/.config/aitm-tui/keys.json), and can be set from the in-app Settings screen.
import { startServer } from "./start.js";

startServer({ mode: "web" }).catch((error) => {
  console.error(`aitm-web: ${error.message}`);
  process.exitCode = 1;
});
