// Local single-user HTTP + SSE adapter. Web mode also serves the desktop renderer (with
// web-api.js swapped in for the Electron preload); API-only mode does not. Both expose
// application commands, upload/repo ingestion, report downloads, and AI progress SSE.
// No auth, accounts, or tenancy: the default loopback bind trusts the local operator.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as core from "./core.js";
import { streamBus } from "../runtime.js";
import { buildHandlers } from "./rpc.js";
import * as ingest from "./ingest.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { rendererDir: RENDERER_DIR } = require("@oak-security/aitm-workbench");
const WEB_DIR = path.join(HERE, "..", "..", "web");

const MAX_RPC_BODY = 40 * 1024 * 1024; // projects.import allows 32MB JSON
const MAX_UPLOAD_BODY = 192 * 1024 * 1024; // base64-encoded upload JSON

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json"
};

const ERROR_STATUS = {
  not_found: 404,
  too_large: 413,
  too_many_files: 413
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendError(res, err) {
  const code = (err && err.code) || "error";
  const message = (err && err.message) || "Unexpected error.";
  if (!err || !err.code) console.error("[aitm-web]", err);
  json(res, ERROR_STATUS[code] || 400, { error: { code, message } });
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("Request body too large."), { code: "too_large" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req, maxBytes) {
  const buf = await readBody(req, maxBytes);
  try {
    return JSON.parse(buf.toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Body is not valid JSON."), { code: "bad_input" });
  }
}

const LOOPBACK = ["localhost", "127.0.0.1", "::1"];

// Host headers and Origin hostnames arrive with ports and IPv6 brackets; compare bare.
function bareHost(value) {
  return String(value || "")
    .trim()
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
}

export function hostAllowed(value, allowed) {
  const host = bareHost(value);
  return Boolean(host) && (LOOPBACK.includes(host) || allowed.has(host));
}

// Two guards, both needed once the server answers on more than loopback:
//   Host  (every request) — the name the browser was pointed at. A DNS-rebinding page
//     resolves its own domain to this address, so its requests carry that domain as
//     Host and fail here. This is what makes a non-loopback bind safe to reach.
//   Origin/Referer (mutating requests) — the page driving the request. Blocks an
//     ordinary cross-site POST. Absent on curl/scripts, which are allowed through:
//     with no session cookie there is no ambient credential for them to replay, so the
//     only thing to defend against is a browser used as a confused deputy.
export function isAllowedOrigin(req, allowed) {
  const raw = req.headers.origin || req.headers.referer;
  if (!raw) return true;
  try {
    return hostAllowed(new URL(raw).hostname, allowed);
  } catch {
    return false;
  }
}

// allowedHosts: extra hostnames this server may be reached by (beyond loopback), e.g. a
// Tailscale MagicDNS name or tailnet IP. Everything else is refused.
export function createWebServer({ allowedHosts = [], serveUi = true } = {}) {
  const allowed = new Set(allowedHosts.map(bareHost).filter(Boolean));
  const handlers = buildHandlers();

  // SSE fanout: the runtime's event sink lands here, and every connected tab gets
  // a copy (the desktop app has one window; a browser may have several).
  const subscribers = new Set();
  const fanout = (payload) => {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of subscribers) res.write(frame);
  };
  streamBus.on("stream", fanout);

  // The renderer's index.html with the web API shim injected before app.js, so
  // window.api exists by the time the renderer runs.
  const indexHtml = serveUi
    ? fs
        .readFileSync(path.join(RENDERER_DIR, "index.html"), "utf8")
        .replace('<script src="app.js"></script>', '<script src="web-api.js"></script>\n    <script src="app.js"></script>')
    : "";

  function serveStatic(res, baseDir, rel) {
    const file = path.normalize(path.join(baseDir, rel));
    if (!file.startsWith(baseDir + path.sep)) return false;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type) return false;
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache", "content-security-policy": CSP });
    res.end(fs.readFileSync(file));
    return true;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://internal");
    const pathname = url.pathname;
    const m = req.method || "GET";

    try {
      if (!hostAllowed(req.headers.host, allowed)) {
        return json(res, 403, {
          error: { code: "bad_host", message: `Refusing requests for host "${String(req.headers.host || "").slice(0, 80)}".` }
        });
      }

      if (pathname === "/api/healthz") return json(res, 200, { ok: true });
      if (m === "GET" && pathname === "/api/commands") {
        return json(res, 200, { commands: Object.keys(handlers).sort() });
      }

      // Static app shell.
      if (m === "GET" && !pathname.startsWith("/api/")) {
        if (!serveUi) return json(res, 404, { error: { code: "not_found", message: "API server mode does not serve a UI." } });
        if (pathname === "/" || pathname === "/index.html") {
          res.writeHead(200, { "content-type": MIME[".html"], "content-security-policy": CSP });
          return res.end(indexHtml);
        }
        const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
        if (serveStatic(res, WEB_DIR, rel)) return;
        if (serveStatic(res, RENDERER_DIR, rel)) return;
        return json(res, 404, { error: { code: "not_found", message: "Not found." } });
      }

      if (m !== "GET" && m !== "HEAD" && !isAllowedOrigin(req, allowed)) {
        return json(res, 403, { error: { code: "bad_origin", message: "Cross-origin request rejected." } });
      }

      if (m === "GET" && pathname === "/api/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        res.write(": connected\n\n");
        subscribers.add(res);
        const hb = setInterval(() => res.write(": ping\n\n"), 15000);
        req.on("close", () => {
          clearInterval(hb);
          subscribers.delete(res);
        });
        return;
      }

      if (m === "POST" && pathname === "/api/rpc") {
        const body = await readJson(req, MAX_RPC_BODY);
        const handler = handlers[body.channel];
        if (!handler) return json(res, 404, { error: { code: "no_channel", message: `Unknown channel: ${String(body.channel).slice(0, 64)}` } });
        const result = await handler(body.payload || {});
        return json(res, 200, { result: result === undefined ? null : result });
      }

      if (m === "POST" && pathname.startsWith("/api/ingest/")) {
        const kind = pathname.slice("/api/ingest/".length);
        const fn = { files: ingest.ingestFiles, folder: ingest.ingestFolder, repo: ingest.ingestRepo }[kind];
        if (!fn) return json(res, 404, { error: { code: "not_found", message: "No such ingest route." } });
        const body = await readJson(req, MAX_UPLOAD_BODY);
        return json(res, 200, await fn(body));
      }

      if (m === "GET" && (pathname === "/api/report/md" || pathname === "/api/report/pdf")) {
        const projectId = url.searchParams.get("projectId") || "";
        const project = core.store.get(projectId);
        const markdown = project.report && project.report.markdown;
        if (!markdown || !markdown.trim()) {
          return json(res, 400, { error: { code: "empty_report", message: "Generate a report before exporting." } });
        }
        const base = `${core.safeDownloadName(project.project.name)}-threat-model`;
        if (pathname.endsWith("/md")) {
          res.writeHead(200, {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="${base}.md"`
          });
          return res.end(markdown);
        }
        const pdf = await core.renderReportPdf({
          title: project.project.name,
          markdown,
          generatedAt: project.report.generatedAt
        });
        res.writeHead(200, {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${base}.pdf"`
        });
        return res.end(pdf);
      }

      return json(res, 404, { error: { code: "not_found", message: "Not found." } });
    } catch (err) {
      if (!res.headersSent) return sendError(res, err);
      res.end();
    }
  });

  server.once("close", () => streamBus.off("stream", fanout));

  return server;
}
