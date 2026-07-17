// The multi-tenant HTTP + SSE server. Serves the desktop renderer as a web app (with
// web-api.js swapped in for the Electron preload), an RPC endpoint mirroring the IPC
// channels, upload/repo ingestion, report downloads, and a per-user SSE stream for AI
// progress events. Every API call runs inside the tenant's AsyncLocalStorage context.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "./core.js";
import { runAs, als } from "./shim.js";
import * as userkeys from "./userkeys.js";
import { AuthManager, sameOrigin, userDirName } from "./auth.js";
import { AiLimiter } from "./limiter.js";
import { buildHandlers } from "./rpc.js";
import * as ingest from "./ingest.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = path.join(core.ROOT, "src", "renderer");
const WEB_DIR = path.join(HERE, "..", "web");

const MAX_RPC_BODY = 40 * 1024 * 1024; // projects.import allows 32MB JSON
const MAX_UPLOAD_BODY = 192 * 1024 * 1024; // base64-encoded upload JSON

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "font-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

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
  rate_limited: 429,
  unauthenticated: 401,
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

export function createWebServer(cfg) {
  const dataRoot = cfg.dataRoot;
  fs.mkdirSync(path.join(dataRoot, "users"), { recursive: true, mode: 0o700 });
  userkeys.initSecret(dataRoot);

  const auth = new AuthManager(cfg);
  const limiter = new AiLimiter({ maxConcurrent: cfg.maxConcurrent, maxPerDay: cfg.maxPerDay });
  const handlers = buildHandlers(limiter);
  const expectedOrigin = cfg.baseUrl ? new URL(cfg.baseUrl).origin : null;
  const enforceOrigin = !cfg.bypass && Boolean(expectedOrigin);

  // One user's cancel only aborts that user's in-flight provider calls.
  core.orchestrate.setScopeProvider(() => {
    const c = als.getStore();
    return c ? c.uid : null;
  });

  // Per-user SSE fanout; the stream shim's emitStream lands here via ctx.emit.
  const subscribers = new Map(); // uid -> Set<res>
  function broadcast(uid, payload) {
    const set = subscribers.get(uid);
    if (!set) return;
    // The model name is an internal detail of the managed service; strip it so it
    // never reaches the browser (not the UI, not the network tab).
    const { model, ...safe } = payload;
    const frame = `data: ${JSON.stringify(safe)}\n\n`;
    for (const res of set) res.write(frame);
  }

  function tenantContext(user) {
    const uid = user.id;
    return {
      uid,
      user,
      dir: path.join(dataRoot, "users", userDirName(uid)),
      emit: (payload) => broadcast(uid, payload)
    };
  }

  // The renderer's index.html with the web API shim injected before app.js.
  const indexHtml = fs
    .readFileSync(path.join(RENDERER_DIR, "index.html"), "utf8")
    .replace('<script src="app.js"></script>', '<script src="web-api.js"></script>\n    <script src="app.js"></script>');
  const loginHtml = fs.readFileSync(path.join(WEB_DIR, "login.html"), "utf8");

  function sendHtml(res, html) {
    res.writeHead(200, { "content-type": MIME[".html"], "content-security-policy": CSP });
    res.end(html);
  }

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

  function serveLogin(res, query) {
    const err = query.get("auth_error");
    const message = err
      ? `<p class="login-error">${escapeHtml(err)}</p>`
      : auth.githubEnabled
        ? ""
        : '<p class="login-error">GitHub OAuth is not configured on this server.</p>';
    sendHtml(res, loginHtml.replace("{{MESSAGE}}", message).replace("{{ORG}}", escapeHtml(cfg.orgs.join(", ") || "allowed users")));
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://internal");
    const pathname = url.pathname;
    const m = req.method || "GET";

    try {
      if (pathname === "/api/healthz") return json(res, 200, { ok: true });

      if (pathname.startsWith("/auth/")) {
        const consumed = await auth.handle(req, res, pathname, url.searchParams);
        if (consumed !== false) return;
        return json(res, 404, { error: { code: "not_found", message: "No such auth route." } });
      }

      // Static app shell. Assets are unauthenticated (no secrets); "/" is gated so an
      // unauthenticated visit lands on the login page.
      if (m === "GET" && !pathname.startsWith("/api/")) {
        if (pathname === "/" || pathname === "/index.html") {
          if (!auth.currentUser(req)) return serveLogin(res, url.searchParams);
          return sendHtml(res, indexHtml);
        }
        const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
        if (serveStatic(res, WEB_DIR, rel)) return;
        if (serveStatic(res, RENDERER_DIR, rel)) return;
        return json(res, 404, { error: { code: "not_found", message: "Not found." } });
      }

      // ---- API: auth + CSRF gates ----
      const user = auth.currentUser(req);
      if (!user) return json(res, 401, { error: { code: "unauthenticated", message: "Not signed in." } });
      const mutating = m !== "GET" && m !== "HEAD";
      if (mutating && enforceOrigin && !sameOrigin(req, expectedOrigin)) {
        return json(res, 403, { error: { code: "bad_origin", message: "Cross-origin request rejected." } });
      }
      const ctx = tenantContext(user);

      if (m === "GET" && pathname === "/api/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        res.write(": connected\n\n");
        let set = subscribers.get(ctx.uid);
        if (!set) subscribers.set(ctx.uid, (set = new Set()));
        set.add(res);
        const hb = setInterval(() => res.write(": ping\n\n"), 15000);
        req.on("close", () => {
          clearInterval(hb);
          set.delete(res);
          if (!set.size) subscribers.delete(ctx.uid);
        });
        return;
      }

      if (m === "POST" && pathname === "/api/rpc") {
        const body = await readJson(req, MAX_RPC_BODY);
        const handler = handlers[body.channel];
        if (!handler) return json(res, 404, { error: { code: "no_channel", message: `Unknown channel: ${String(body.channel).slice(0, 64)}` } });
        const result = await runAs(ctx, () => handler(body.payload || {}, ctx));
        return json(res, 200, { result: result === undefined ? null : result });
      }

      if (m === "POST" && pathname.startsWith("/api/ingest/")) {
        const kind = pathname.slice("/api/ingest/".length);
        const fn = { files: ingest.ingestFiles, folder: ingest.ingestFolder, repo: ingest.ingestRepo }[kind];
        if (!fn) return json(res, 404, { error: { code: "not_found", message: "No such ingest route." } });
        const body = await readJson(req, MAX_UPLOAD_BODY);
        const result = await runAs(ctx, () => fn(body));
        return json(res, 200, result);
      }

      if (m === "GET" && (pathname === "/api/report/md" || pathname === "/api/report/pdf")) {
        const projectId = url.searchParams.get("projectId") || "";
        return await runAs(ctx, async () => {
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
        });
      }

      return json(res, 404, { error: { code: "not_found", message: "Not found." } });
    } catch (err) {
      if (!res.headersSent) return sendError(res, err);
      res.end();
    }
  });

  return server;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
