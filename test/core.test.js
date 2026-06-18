"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const schema = require("../src/main/projects/schema");
const phases = require("../src/main/phases");
const render = require("../src/main/report/render");
const { buildFolderDigest } = require("../src/main/ingest/digest");

test("schema: createProject has required phases and empty model", () => {
  const p = schema.createProject("Demo");
  assert.equal(p.schemaVersion, schema.SCHEMA_VERSION);
  assert.equal(p.project.name, "Demo");
  for (const id of ["scope", "ingest", "trace-model", "stride", "report"]) {
    assert.ok(p.phasesEnabled.includes(id), `missing ${id}`);
  }
  assert.deepEqual(p.traceModel.protectedAssets, []);
});

test("schema: normalize migrates legacy v1 (systemModel + privilegedRoles + abcCollusion)", () => {
  const legacy = {
    project: { name: "Legacy", id: "11111111-1111-1111-1111-111111111111" },
    systemModel: {
      protectedAssets: [{ name: "Treasury" }],
      privilegedRoles: [{ role: "Admin" }]
    },
    abcCollusion: { enabled: true, scenarios: [{ actors: "signers" }] }
  };
  const p = schema.normalize(legacy);
  assert.equal(p.schemaVersion, schema.SCHEMA_VERSION);
  assert.equal(p.traceModel.protectedAssets[0].name, "Treasury");
  assert.equal(p.traceModel.roles[0].role, "Admin", "privilegedRoles -> roles");
  assert.equal(p.coordination.enabled, true, "abcCollusion -> coordination");
});

test("phases: coordination defaults off unless classification flags it", () => {
  const off = phases.registry({ coordinationRelevant: false }).find((x) => x.id === "coordination");
  const on = phases.registry({ coordinationRelevant: true }).find((x) => x.id === "coordination");
  assert.equal(off.defaultEnabled, false);
  assert.equal(on.defaultEnabled, true);
});

test("phases: seedEnabled turns coordination on when newly relevant, keeps required", () => {
  const prev = ["scope", "ingest", "trace-model", "stride", "report"]; // no coordination
  const seeded = phases.seedEnabled({ coordinationRelevant: true }, prev);
  assert.ok(seeded.includes("coordination"), "coordination enabled when relevant");
  assert.ok(seeded.includes("scope") && seeded.includes("report"), "required kept");
});

test("phases: required phases cannot be implicitly dropped", () => {
  const seeded = phases.seedEnabled({ coordinationRelevant: false }, []);
  for (const id of phases.REQUIRED_IDS) assert.ok(seeded.includes(id), `required ${id} present`);
});

test("render: markdown table becomes an HTML table", () => {
  const md = "## Risks\n\n| Threat | Risk |\n| --- | --- |\n| Spoofing | High |\n";
  const html = render.bodyToHtml(md);
  assert.match(html, /<h2>Risks<\/h2>/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>Threat<\/th>/);
  assert.match(html, /<td>High<\/td>/);
});

test("ingest: buildFolderDigest honors .gitignore and skips heavy dirs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-ingest-"));
  fs.writeFileSync(path.join(root, "main.go"), "package main\nfunc main(){}\n");
  fs.writeFileSync(path.join(root, "secret.txt"), "ignore me");
  fs.writeFileSync(path.join(root, ".gitignore"), "secret.txt\n");
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules", "lib.js"), "x");
  const digest = buildFolderDigest(root);
  assert.equal(digest.type, "folder");
  assert.ok(digest.files.includes("main.go"));
  assert.ok(!digest.files.includes("secret.txt"), "gitignored file excluded");
  assert.ok(!digest.files.some((f) => f.includes("node_modules")), "node_modules skipped");
  fs.rmSync(root, { recursive: true, force: true });
});

test("ingest: buildFolderDigest rejects a symlink escaping the root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-esc-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-out-"));
  fs.writeFileSync(path.join(outside, "leak.txt"), "secret");
  try {
    fs.symlinkSync(outside, path.join(root, "link"));
  } catch {
    return; // symlinks unsupported in this environment; skip
  }
  assert.throws(() => buildFolderDigest(root), /symlink/i);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});
