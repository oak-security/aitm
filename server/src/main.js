#!/usr/bin/env node
// aitm-web — multi-tenant web server for AiTM. Config via environment:
//   AITM_WEB_PORT       listen port (default 8790)
//   AITM_WEB_HOST       bind address (default 127.0.0.1; run behind a TLS proxy)
//   AITM_WEB_DATA       data root (default ~/.local/share/aitm-web)
//   AITM_WEB_BASE_URL   public URL, e.g. https://aitm.oaksecurity.io (OAuth + CSRF)
//   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET   OAuth app credentials
//   AITM_ALLOWED_ORGS   comma list of GitHub orgs whose members may sign in
//                       (default oak-security)
//   AITM_ALLOWED_USERS  comma list of extra GitHub logins (OR with orgs)
//   AITM_AUTH_BYPASS=1  skip auth for local testing (localhost base URL only)
//   AITM_MAX_CONCURRENT_AI / AITM_MAX_AI_PER_DAY   per-user limits (2 / unlimited)
//   AITM_KEY_SECRET     secret encrypting stored per-user provider keys
//                       (default: generated at <data>/.keysecret)
//   OPENAI_API_KEY      shared OpenAI key for all users (hosted build is OpenAI-only)
//   AITM_MODEL_FAST / AITM_MODEL_DEEP   model overrides (gpt-5-mini / gpt-5.5)
import os from "node:os";
import path from "node:path";
import { createWebServer } from "./server.js";

function csv(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const port = intEnv("AITM_WEB_PORT", 8790);
const host = process.env.AITM_WEB_HOST || "127.0.0.1";
const bypass = process.env.AITM_AUTH_BYPASS === "1";

const cfg = {
  dataRoot: process.env.AITM_WEB_DATA || path.join(os.homedir(), ".local", "share", "aitm-web"),
  baseUrl: (process.env.AITM_WEB_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
  clientId: process.env.GITHUB_CLIENT_ID || "",
  clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
  orgs: csv(process.env.AITM_ALLOWED_ORGS ?? "oak-security"),
  users: csv(process.env.AITM_ALLOWED_USERS),
  bypass,
  maxConcurrent: intEnv("AITM_MAX_CONCURRENT_AI", 2),
  maxPerDay: intEnv("AITM_MAX_AI_PER_DAY", 0)
};

if (!bypass && (!cfg.clientId || !cfg.clientSecret)) {
  console.error("aitm-web: GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET are required (or set AITM_AUTH_BYPASS=1 for local testing).");
  process.exit(1);
}

if (!(process.env.OPENAI_API_KEY || "").trim()) {
  console.warn("aitm-web: OPENAI_API_KEY is not set; AI steps will fail until it is (hosted build is OpenAI-only).");
}

let server;
try {
  server = createWebServer(cfg);
} catch (err) {
  console.error(`aitm-web: ${err.message}`);
  process.exit(1);
}

server.listen(port, host, () => {
  console.log(`aitm-web listening on http://${host}:${port} (base ${cfg.baseUrl})`);
  console.log(`data root: ${cfg.dataRoot}`);
  if (bypass) console.log("AUTH BYPASS is ON — local testing only.");
  else console.log(`access: org ${cfg.orgs.join(", ") || "(none)"}${cfg.users.length ? ` + users ${cfg.users.join(", ")}` : ""}`);
});
