"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ENTRY = path.join(ROOT, "cli", "src", "aitm.js");

function cli(args, env = {}) {
  return spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 15000
  });
}

test("cli: argument parser selects explicit UI, programmatic, and serve modes", async () => {
  const { parseArgs, selectMode } = await import(path.join(ROOT, "cli", "src", "args.js"));
  assert.deepEqual(parseArgs(["-p", "run", "docs", "--trees=2"]), {
    positional: ["run", "docs"],
    flags: { print: true, trees: "2" }
  });
  assert.deepEqual(parseArgs(["serve", "--host", "127.0.0.1"]), {
    positional: ["serve"],
    flags: { host: "127.0.0.1" }
  });
  assert.throws(() => parseArgs(["-s"]), /Unknown option/);
  assert.equal(selectMode(["tui", "docs"], {}), "tui");
  assert.equal(selectMode(["gui"], {}), "gui");
  assert.equal(selectMode(["web"], {}), "web");
  assert.equal(selectMode(["serve"], {}), "server");
  assert.equal(selectMode([], { print: true }), "print");
  assert.equal(selectMode([], {}), "help");
  assert.throws(() => selectMode(["docs"], {}), /Unknown startup mode/);
  assert.throws(() => selectMode(["gui"], { print: true }), /Choose one startup mode/);
});

test("cli: help and version are available without loading a frontend", () => {
  const help = cli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /aitm serve \[options\]/);
  assert.match(help.stdout, /aitm -p \[command/);
  assert.match(help.stdout, /aitm tui \[source/);
  assert.match(help.stdout, /aitm gui/);

  const bare = cli([]);
  assert.equal(bare.status, 0, bare.stderr);
  assert.equal(bare.stdout, help.stdout);

  const implicit = cli(["."]);
  assert.notEqual(implicit.status, 0);
  assert.match(implicit.stderr, /Unknown startup mode/);

  const tui = cli(["tui"]);
  assert.notEqual(tui.status, 0);
  assert.match(tui.stderr, /TUI needs an interactive terminal/);

  const version = cli(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), `aitm ${require("../package.json").version}`);
});

test("cli: programmatic project commands run in-process without a server", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-cli-data-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-cli-conf-"));
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-cli-source-"));
  fs.writeFileSync(path.join(sourceDir, "architecture.md"), "# Architecture\nA local web application.");

  const env = { AITM_DATA_DIR: dataDir, AITM_TUI_CONFIG_DIR: configDir };
  const empty = cli(["-p", "projects", "--json"], env);
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), []);

  const created = cli(["-p", "new", sourceDir, "--name", "CLI project", "--json", "--quiet"], env);
  assert.equal(created.status, 0, created.stderr);
  const project = JSON.parse(created.stdout);
  assert.equal(project.project.name, "CLI project");
  assert.equal(project.sources.length, 1);

  const listed = cli(["-p", "projects", "--json"], env);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout)[0].id, project.project.id);
});
