#!/usr/bin/env node
// aitm-web — local web frontend for AiTM. Single-user, no authentication: it serves the
// desktop renderer in the browser against the same project store the desktop app and the
// TUI use. Config via environment:
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
import { createWebServer } from "./server.js";
import { userDataDir } from "./shim.js";

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function csv(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const port = intEnv("AITM_WEB_PORT", 8790);
const host = process.env.AITM_WEB_HOST || "127.0.0.1";
const loopback = ["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"].includes(host);

// Whatever it is bound to is a name it can legitimately be reached by.
const allowedHosts = [...csv(process.env.AITM_WEB_ALLOWED_HOSTS), ...(loopback ? [] : [host])];

const server = createWebServer({ allowedHosts });

server.listen(port, host, () => {
  console.log(`aitm-web listening on http://${host}:${port}`);
  console.log(`data dir: ${userDataDir()}`);
  if (allowedHosts.length) console.log(`also answers to: ${allowedHosts.join(", ")}`);
  if (!loopback) {
    console.warn(
      `WARNING: bound to ${host}, which is not loopback. aitm-web has no authentication — ` +
        "anyone who can reach this port has full access to your projects and API keys."
    );
  }
});
