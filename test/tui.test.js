"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The TUI is ESM; load it via dynamic import. Point its data dirs at temp locations
// before first import so the CLI runtime and key file never touch real user data.
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-tui-test-data-"));
const tmpConf = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-tui-test-conf-"));
process.env.AITM_DATA_DIR = tmpData;
process.env.AITM_TUI_CONFIG_DIR = tmpConf;

const tui = (p) => import(path.join(__dirname, "..", "packages", "cli", "src", "tui", p));

test("tui core: loads the engine package without an Electron shim", async () => {
  const core = await tui("core.js");
  assert.equal(typeof core.application.runPipeline, "function");
  assert.equal(typeof core.orchestrate.scopeFilter, "function");
  assert.equal(typeof core.digest.buildFolderDigest, "function");
  assert.equal(typeof core.renderReportPdf, "function");
});

test("tui core: store round-trips a project in AITM_DATA_DIR", async () => {
  const core = await tui("core.js");
  const project = core.store.create({ name: "TUI test" });
  project.scope.inScope = "only docs";
  const saved = core.store.persist(project);
  const loaded = core.store.get(saved.project.id);
  assert.equal(loaded.project.name, "TUI test");
  assert.equal(loaded.scope.inScope, "only docs");
  assert.ok(fs.existsSync(path.join(tmpData, "projects", `${saved.project.id}.json`)));
  core.store.remove(saved.project.id);
});

test("tui keys: env var wins over key file, setKey persists mode 600", async () => {
  const keys = await tui("keys.js");
  process.env.OPENAI_API_KEY = "sk-env-test-1234";
  assert.equal(keys.readKey("openai"), "sk-env-test-1234");
  delete process.env.OPENAI_API_KEY;
  keys.setKey("anthropic", "sk-ant-file-5678");
  assert.equal(keys.readKey("anthropic"), "sk-ant-file-5678");
  const mode = fs.statSync(path.join(tmpConf, "keys.json")).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.equal(keys.status().providers.anthropic.last4, "5678");
  keys.clearKey("anthropic");
  assert.equal(keys.readKey("anthropic"), "");
});

test("tui sources: target resolution (dir, file, repo url, default cwd)", async () => {
  const sources = await tui("sources.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-tui-test-src-"));
  const file = path.join(dir, "spec.md");
  fs.writeFileSync(file, "# spec");
  assert.deepEqual(sources.resolveTargets([]), [{ kind: "dir", ref: process.cwd() }]);
  assert.equal(sources.resolveTargets([dir])[0].kind, "dir");
  assert.equal(sources.resolveTargets([file])[0].kind, "file");
  assert.equal(sources.resolveTargets(["https://github.com/oak-security/TRACE"])[0].kind, "repo");
  assert.equal(sources.resolveTargets(["git@github.com:oak-security/TRACE.git"])[0].kind, "repo");
  assert.throws(() => sources.resolveTargets([path.join(dir, "missing")]), /No such file/);
  assert.equal(sources.repoLabel("https://github.com/oak-security/TRACE.git"), "oak-security/TRACE");
});

test("tui sources: listDirs skips vendored/hidden dirs", async () => {
  const sources = await tui("sources.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-tui-test-walk-"));
  for (const d of ["docs", "src/deep", "node_modules/x", ".git/objects"]) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  const dirs = sources.listDirs(root);
  assert.ok(dirs.includes("docs"));
  assert.ok(dirs.includes(path.join("src", "deep")));
  assert.ok(!dirs.some((d) => d.includes("node_modules") || d.includes(".git")));
});

test("tui pipeline: topThreats ranks by risk and drops non-applicable", async () => {
  const pipeline = await tui("pipeline.js");
  const threats = [
    { id: "a", risk: "Low", isApplicable: true },
    { id: "b", risk: "Critical", isApplicable: true },
    { id: "c", risk: "High", isApplicable: false },
    { id: "d", risk: "Medium", isApplicable: true }
  ];
  assert.deepEqual(pipeline.topThreats(threats, 2).map((t) => t.id), ["b", "d"]);
});

test("tui pipeline: summarize covers every step id", async () => {
  const pipeline = await tui("pipeline.js");
  const core = await tui("core.js");
  const project = core.schema.createProject("Summarize");
  project.strideThreats = [{ risk: "High", isApplicable: true }];
  for (const step of pipeline.STEPS) {
    const lines = pipeline.summarize(step.id, project);
    assert.ok(Array.isArray(lines) && lines.length > 0, `summary for ${step.id}`);
  }
});

test("tui schemas: scope filter schema and prompt are registered", async () => {
  const core = await tui("core.js");
  const schemas = require("../packages/engine/src/ai/schemas");
  const prompts = require("../packages/engine/src/ai/prompts");
  const s = schemas.scopeFilterSchema();
  assert.deepEqual(s.required, ["include", "note"]);
  assert.ok(prompts.SCOPE_FILTER.includes("scope hint"));
  assert.ok(core.settings.get().provider);
});
