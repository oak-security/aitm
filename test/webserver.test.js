"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

// The web UI shares the desktop app's data dir and the non-Electron key file; point both
// at temp dirs, and clear the env keys that would otherwise flip keystore.status.
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-web-test-"));
const tmpKeys = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-web-keys-"));
process.env.AITM_DATA_DIR = tmpData;
process.env.AITM_TUI_CONFIG_DIR = tmpKeys;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const srv = (p) => import(path.join(__dirname, "..", "server", "src", p));

test("ingest: sanitizeRel blocks traversal and absolute paths", async () => {
  const { sanitizeRel } = await srv("ingest.js");
  assert.equal(sanitizeRel("docs/arch.md"), "docs/arch.md");
  for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:whatever", "a\\b", "a/./b/../c", ""]) {
    assert.throws(() => sanitizeRel(bad), undefined, `should reject: ${bad}`);
  }
});

test("ingest: repo URL may not start with a dash (git argv injection)", async () => {
  const { ingestRepo } = await srv("ingest.js");
  await assert.rejects(() => ingestRepo({ url: "--upload-pack=whoami x.git" }), /may not start/);
  await assert.rejects(() => ingestRepo({ url: "not a url" }), /git repository URL/);
});

test("host guard: loopback plus configured names, ports and brackets ignored", async () => {
  const { hostAllowed } = await srv("server.js");
  const none = new Set();
  const tailnet = new Set(["devbox.example.ts.net", "100.78.168.128"]);
  assert.ok(hostAllowed("localhost:8790", none));
  assert.ok(hostAllowed("127.0.0.1", none));
  assert.ok(hostAllowed("[::1]:8790", none));
  assert.ok(!hostAllowed("evil.example", none), "unconfigured name refused");
  assert.ok(!hostAllowed("100.78.168.128", none), "tailnet IP refused until configured");
  assert.ok(hostAllowed("DevBox.Example.TS.net", tailnet), "case-insensitive");
  assert.ok(hostAllowed("100.78.168.128:8790", tailnet));
  assert.ok(!hostAllowed("", tailnet));
  assert.ok(!hostAllowed(undefined, tailnet));
});

test("origin guard: same allowlist, header-less clients allowed", async () => {
  const { isAllowedOrigin } = await srv("server.js");
  const none = new Set();
  const tailnet = new Set(["devbox.example.ts.net"]);
  assert.ok(isAllowedOrigin({ headers: {} }, none), "curl/scripts have no ambient credential");
  assert.ok(isAllowedOrigin({ headers: { origin: "http://localhost:8790" } }, none));
  assert.ok(isAllowedOrigin({ headers: { referer: "http://localhost:8790/index.html" } }, none));
  assert.ok(!isAllowedOrigin({ headers: { origin: "https://evil.example" } }, none), "cross-site");
  assert.ok(!isAllowedOrigin({ headers: { origin: "http://rebind.evil.example" } }, none), "DNS rebinding");
  assert.ok(!isAllowedOrigin({ headers: { origin: "garbage" } }, none));
  assert.ok(isAllowedOrigin({ headers: { origin: "https://devbox.example.ts.net" } }, tailnet));
  assert.ok(!isAllowedOrigin({ headers: { origin: "https://devbox.example.ts.net" } }, none), "not allowlisted");
});

test("core: web server shares the desktop app's project store", async () => {
  const core = await srv("core.js");
  assert.equal(core.userDataDir(), tmpData);
  const created = core.store.create({ name: "Shared store" });
  assert.ok(fs.existsSync(path.join(tmpData, "projects", `${created.project.id}.json`)));
  assert.deepEqual(core.store.list().map((p) => p.name), ["Shared store"]);
  core.store.remove(created.project.id);
});

test("contract: web-api.js exposes every api.* method the renderer calls", () => {
  const vm = require("node:vm");
  const shimCode = fs.readFileSync(path.join(__dirname, "..", "server", "web", "web-api.js"), "utf8");
  const sandbox = {
    window: {},
    document: { addEventListener() {}, createElement: () => ({ style: {} }), body: { appendChild() {}, classList: { add() {} } } },
    fetch: () => Promise.resolve(),
    EventSource: class {},
    FileReader: class {},
    URL,
    location: {},
    setTimeout
  };
  vm.runInNewContext(shimCode, sandbox);
  const api = sandbox.window.api;
  assert.ok(api, "window.api defined");

  const appJs = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "app.js"), "utf8");
  const used = new Set();
  for (const m of appJs.matchAll(/\bapi\.([a-zA-Z]+)\.([a-zA-Z]+)\(/g)) used.add(`${m[1]}.${m[2]}`);
  assert.ok(used.size > 20, "found renderer call sites");
  for (const name of used) {
    const [ns, fn] = name.split(".");
    if (ns === "app") continue; // desktop-only; renderer guards on api.app
    assert.equal(typeof (api[ns] || {})[fn], "function", `web api missing ${name}`);
  }
});

test("renderer: no hosted-build branches remain", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "app.js"), "utf8");
  const webApi = fs.readFileSync(path.join(__dirname, "..", "server", "web", "web-api.js"), "utf8");
  assert.ok(!/AITM_HOSTED|\bHOSTED\b/.test(appJs), "renderer is host-agnostic (feature detection only)");
  assert.ok(!/AITM_HOSTED|hosted\.css|\/auth\//.test(webApi), "web shim has no hosted/auth hooks");
});

test("e2e: server serves app, rpc, ingest, settings, stream", async () => {
  const { createWebServer } = await srv("server.js");
  const server = createWebServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${base}/api/healthz`);
    assert.deepEqual(await health.json(), { ok: true });

    // No login gate: "/" serves the app directly.
    const home = await fetch(base);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.ok(html.includes('src="web-api.js"'), "web api shim injected");
    assert.ok(html.includes('src="app.js"'), "renderer app served");
    assert.ok(html.indexOf('src="web-api.js"') < html.indexOf('src="app.js"'), "shim runs before app.js");
    assert.ok(!html.includes("hosted.css"), "no hosted restyle");
    assert.ok(home.headers.get("content-security-policy"), "CSP header set");

    assert.equal((await fetch(`${base}/web-api.js`)).status, 200);
    assert.equal((await fetch(`${base}/styles.css`)).status, 200);
    assert.equal((await fetch(`${base}/hosted.css`)).status, 404, "restyle is gone");

    const rpc = (channel, payload, headers = {}) =>
      fetch(`${base}/api/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ channel, payload })
      }).then(async (r) => ({ status: r.status, body: await r.json() }));

    const created = await rpc("projects.create", { name: "Web e2e" });
    assert.equal(created.status, 200);
    const pid = created.body.result.project.id;
    assert.equal((await rpc("projects.list", {})).body.result.length, 1);
    assert.equal((await rpc("nope.nope", {})).status, 404);

    // Cross-origin mutating requests are refused; loopback ones pass.
    const foreign = await rpc("projects.create", { name: "CSRF" }, { origin: "https://evil.example" });
    assert.equal(foreign.status, 403);
    assert.equal((await rpc("projects.list", {})).body.result.length, 1, "nothing created");

    // A rebound name resolving to this address is refused on the Host header alone.
    // (fetch() forbids setting Host, so this one goes through the raw client.)
    const rebound = await new Promise((resolve, reject) => {
      const r = http.request(
        { host: "127.0.0.1", port, path: "/", method: "GET", headers: { host: "rebind.evil.example" } },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        }
      );
      r.on("error", reject);
      r.end();
    });
    assert.equal(rebound.status, 403);
    assert.equal(JSON.parse(rebound.body).error.code, "bad_host");

    // Settings are real again (no forced provider/model), backed by settings.json.
    const sset = await rpc("settings.set", { provider: "anthropic", modelFast: "claude-sonnet-5" });
    assert.equal(sset.body.result.provider, "anthropic", "provider is user-controlled");
    assert.equal(sset.body.result.modelFast, "claude-sonnet-5");
    assert.equal((await rpc("settings.get", {})).body.result.provider, "anthropic");
    await rpc("settings.set", { provider: "openai" });

    // Keystore resolves to the shared non-Electron key file, not the Electron vault.
    assert.equal((await rpc("keystore.status", {})).body.result.providers.openai.configured, false);
    const set = await rpc("keystore.set", { provider: "openai", key: "sk-e2e-wxyz" });
    assert.equal(set.body.result.providers.openai.configured, true);
    assert.equal(set.body.result.providers.openai.last4, "wxyz");
    assert.ok(fs.existsSync(path.join(tmpKeys, "keys.json")), "key file is the TUI's");
    assert.equal(fs.statSync(path.join(tmpKeys, "keys.json")).mode & 0o777, 0o600);
    await rpc("keystore.clear", { provider: "openai" });

    const up = await fetch(`${base}/api/ingest/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [{ name: "spec.md", dataBase64: Buffer.from("# Spec\nHello").toString("base64") }] })
    });
    const upBody = await up.json();
    assert.equal(up.status, 200);
    assert.equal(upBody.sources.length, 1);
    assert.equal(upBody.sources[0].type, "files");

    const evil = await fetch(`${base}/api/ingest/folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "x", files: [{ rel: "../escape.txt", dataBase64: "aGk=" }] })
    });
    assert.equal(evil.status, 400, "traversal rejected");

    assert.equal((await fetch(`${base}/api/report/md?projectId=${pid}`)).status, 400, "empty report rejected");
    assert.notEqual((await fetch(`${base}/..%2f..%2fpackage.json`)).status, 200, "static traversal blocked");

    const sse = await new Promise((resolve, reject) => {
      const req = http.get(`${base}/api/stream`, (res) => {
        resolve(res.headers["content-type"]);
        req.destroy();
      });
      req.on("error", reject);
    });
    assert.equal(sse, "text/event-stream");
  } finally {
    server.close();
  }
});
