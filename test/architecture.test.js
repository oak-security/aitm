"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function jsFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...jsFiles(file));
    else if (entry.name.endsWith(".js")) files.push(file);
  }
  return files;
}

test("architecture: engine and CLI packages have no Electron dependency", () => {
  for (const packageName of ["engine", "cli"]) {
    const packageRoot = path.join(ROOT, "packages", packageName);
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    assert.equal(manifest.dependencies?.electron, undefined);
    assert.equal(manifest.devDependencies?.electron, undefined);
    for (const file of jsFiles(path.join(packageRoot, "src"))) {
      assert.ok(!/require\(["']electron["']\)|from ["']electron["']/.test(fs.readFileSync(file, "utf8")), file);
    }
  }
});

test("architecture: every shipped package shares one release version", () => {
  const manifests = ["package.json", "packages/engine/package.json", "packages/workbench/package.json", "packages/cli/package.json"];
  const versions = manifests.map((file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")).version);
  assert.equal(new Set(versions).size, 1);
  assert.match(versions[0], /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});

test("architecture: desktop and CLI depend on engine through package metadata", () => {
  const desktop = require("../package.json");
  const cli = require("../packages/cli/package.json");
  assert.equal(desktop.dependencies["@oak-security/aitm-engine"], desktop.version);
  assert.equal(desktop.dependencies["@oak-security/aitm-workbench"], desktop.version);
  assert.equal(cli.dependencies["@oak-security/aitm-engine"], cli.version);
  assert.equal(cli.dependencies["@oak-security/aitm-workbench"], cli.version);
  assert.equal(desktop.bin, undefined, "desktop package does not pretend to install the CLI");
  assert.equal(cli.bin.aitm, "src/aitm.js");
});

test("release: desktop publishing is Apple Silicon, signed, and non-draft", () => {
  const desktop = require("../package.json");
  const builder = require("../electron-builder.js");
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8");

  assert.match(desktop.scripts["publish:ci"], /--mac\s+--arm64\s+--publish\s+always/);
  assert.equal(builder.publish[0].releaseType, "release");
  for (const secret of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
    assert.ok(workflow.includes(secret), `release workflow must require ${secret}`);
  }
  assert.ok(workflow.includes("npm run pack:check"));
  assert.ok(workflow.includes("npm run verify:release"));
});
