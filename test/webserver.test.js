"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

// Server-wide env keys would flip keystore.status in tests; clear them.
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-web-test-"));
const srv = (p) => import(path.join(__dirname, "..", "server", "src", p));

const CFG = {
  dataRoot: tmpData,
  baseUrl: "http://localhost:8790",
  clientId: "",
  clientSecret: "",
  orgs: ["oak-security"],
  users: [],
  bypass: true,
  maxConcurrent: 2,
  maxPerDay: 0
};

test("auth: bypass refused on non-localhost base URL", async () => {
  const { AuthManager } = await srv("auth.js");
  assert.throws(
    () => new AuthManager({ ...CFG, baseUrl: "https://aitm.oaksecurity.io" }),
    /localhost/
  );
  const ok = new AuthManager(CFG);
  assert.equal(ok.currentUser({ headers: {} }).id, "local:dev");
});

test("auth: session mint/lookup and cookie parsing", async () => {
  const { AuthManager } = await srv("auth.js");
  const a = new AuthManager({ ...CFG, bypass: false });
  const user = { id: "gh:42", login: "alice" };
  const sid = a.mintSession(user);
  assert.equal(a.currentUser({ headers: { cookie: `foo=bar; aitm_sess=${sid}` } }).login, "alice");
  assert.equal(a.currentUser({ headers: { cookie: "aitm_sess=bogus" } }), null);
  assert.equal(a.currentUser({ headers: {} }), null);
});

test("auth: sameOrigin accepts own origin, rejects foreign and headerless", async () => {
  const { sameOrigin } = await srv("auth.js");
  const exp = "https://aitm.oaksecurity.io";
  assert.ok(sameOrigin({ headers: { origin: exp } }, exp));
  assert.ok(!sameOrigin({ headers: { origin: "https://evil.example" } }, exp));
  assert.ok(!sameOrigin({ headers: {} }, exp));
  assert.ok(sameOrigin({ headers: { referer: `${exp}/somewhere` } }, exp));
});

test("ingest: sanitizeRel blocks traversal and absolute paths", async () => {
  const { sanitizeRel } = await srv("ingest.js");
  assert.equal(sanitizeRel("docs/arch.md"), "docs/arch.md");
  for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:whatever", "a\\b", "a/./b/../c", ""]) {
    assert.throws(() => sanitizeRel(bad), undefined, `should reject: ${bad}`);
  }
});

test("limiter: concurrent and daily caps", async () => {
  const { AiLimiter } = await srv("limiter.js");
  const l = new AiLimiter({ maxConcurrent: 2, maxPerDay: 3 });
  assert.ok(l.check("u").ok);
  l.begin("u");
  l.begin("u");
  assert.ok(!l.check("u").ok, "concurrent cap");
  l.end("u");
  assert.ok(l.check("u").ok);
  l.begin("u");
  l.end("u");
  l.end("u");
  assert.ok(!l.check("u").ok, "daily cap after 3 begins");
  assert.ok(l.check("other").ok, "per-user");
});

test("userkeys: encrypted roundtrip and env fallback", async () => {
  const userkeys = await srv("userkeys.js");
  userkeys.initSecret(tmpData);
  const dir = path.join(tmpData, "users", "gh-1");
  assert.equal(userkeys.readKey(dir, "openai"), "");
  userkeys.setKey(dir, "openai", "sk-own-key-9999");
  assert.equal(userkeys.readKey(dir, "openai"), "sk-own-key-9999");
  const raw = fs.readFileSync(path.join(dir, "keys.enc"), "utf8");
  assert.ok(!raw.includes("sk-own-key"), "key not stored in plaintext");
  process.env.ANTHROPIC_API_KEY = "sk-ant-env-1234";
  assert.equal(userkeys.readKey(dir, "anthropic"), "sk-ant-env-1234", "env fallback");
  assert.equal(userkeys.status(dir).providers.anthropic.last4, "1234");
  delete process.env.ANTHROPIC_API_KEY;
  userkeys.clearKey(dir, "openai");
  assert.equal(userkeys.readKey(dir, "openai"), "");
});

test("tenancy: AsyncLocalStorage contexts give users isolated stores", async () => {
  const { runAs } = await srv("shim.js");
  const core = await srv("core.js");
  const ctxA = { uid: "gh:1", dir: path.join(tmpData, "users", "gh-1"), emit: () => {} };
  const ctxB = { uid: "gh:2", dir: path.join(tmpData, "users", "gh-2"), emit: () => {} };
  const a = await runAs(ctxA, () => core.store.create({ name: "Alice's model" }));
  await runAs(ctxB, () => core.store.create({ name: "Bob's model" }));
  const listA = await runAs(ctxA, () => core.store.list());
  const listB = await runAs(ctxB, () => core.store.list());
  assert.deepEqual(listA.map((p) => p.name), ["Alice's model"]);
  assert.deepEqual(listB.map((p) => p.name), ["Bob's model"]);
  await assert.rejects(async () => runAs(ctxB, () => core.store.get(a.project.id)), /not found/i);
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

test("e2e: bypass server serves app, rpc, ingest, stream", async () => {
  const { createWebServer } = await srv("server.js");
  const server = createWebServer(CFG);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${base}/api/healthz`);
    assert.deepEqual(await health.json(), { ok: true });

    const home = await fetch(base);
    const html = await home.text();
    assert.ok(html.includes('src="web-api.js"'), "web api shim injected");
    assert.ok(html.includes('src="app.js"'), "renderer app served");
    assert.ok(home.headers.get("content-security-policy"), "CSP header set");
    // Hosted restyle: hosted.css linked after styles.css and served.
    assert.ok(html.indexOf("styles.css") < html.indexOf("hosted.css"), "hosted.css after styles.css");
    const hostedCss = await fetch(`${base}/hosted.css`);
    assert.equal(hostedCss.status, 200);
    assert.match(hostedCss.headers.get("content-type"), /text\/css/);

    const shim = await fetch(`${base}/web-api.js`);
    assert.equal(shim.status, 200);
    const css = await fetch(`${base}/styles.css`);
    assert.equal(css.status, 200);

    const rpc = (channel, payload) =>
      fetch(`${base}/api/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, payload })
      }).then(async (r) => ({ status: r.status, body: await r.json() }));

    const created = await rpc("projects.create", { name: "Web e2e" });
    assert.equal(created.status, 200);
    const pid = created.body.result.project.id;
    const list = await rpc("projects.list", {});
    assert.equal(list.body.result.length, 1);

    const unknown = await rpc("nope.nope", {});
    assert.equal(unknown.status, 404);

    const ks = await rpc("keystore.status", {});
    assert.equal(ks.body.result.providers.openai.configured, false);

    // keystore.set must resolve to the per-user shim (not the real Electron keystore).
    // Hosted mode is OpenAI-only: settings are forced regardless of what is requested.
    const sget = await rpc("settings.get", {});
    assert.equal(sget.body.result.provider, "openai");
    const sset = await rpc("settings.set", { provider: "anthropic", modelFast: "claude-x" });
    assert.equal(sset.body.result.provider, "openai", "provider cannot be changed");
    assert.equal(sset.body.result.modelFast, "gpt-5-mini", "models forced");

    const set = await rpc("keystore.set", { provider: "openai", key: "sk-e2e-wxyz" });
    assert.equal(set.status, 200);
    assert.equal(set.body.result.providers.openai.configured, true);
    assert.equal(set.body.result.providers.openai.last4, "wxyz");
    assert.equal(set.body.result.encryptionAvailable, true);
    const enc = fs.readFileSync(path.join(tmpData, "users", "local-dev", "keys.enc"), "utf8");
    assert.ok(!enc.includes("sk-e2e"), "stored key is ciphertext");

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

    const md = await fetch(`${base}/api/report/md?projectId=${pid}`);
    assert.equal(md.status, 400, "empty report rejected");

    const traversal = await fetch(`${base}/..%2f..%2fpackage.json`);
    assert.notEqual(traversal.status, 200, "static traversal blocked");

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
