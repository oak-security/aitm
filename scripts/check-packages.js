"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const workspaces = ["@oak-security/aitm-engine", "@oak-security/aitm-workbench", "@oak-security/aitm"];
const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-pack-check-"));
const cache = path.join(process.env.TMPDIR || "/tmp", "aitm-npm-cache");

try {
  for (const workspace of workspaces) {
    const result = spawnSync(
      "npm",
      ["pack", "--workspace", workspace, "--pack-destination", packDir, "--cache", cache],
      { cwd: root, env: process.env, encoding: "utf8", stdio: "ignore" }
    );
    if (result.status !== 0) throw new Error(`Could not pack ${workspace}`);

    const archives = fs.readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
    if (archives.length !== 1) throw new Error(`Expected one archive for ${workspace}, found ${archives.length}`);
    const archive = path.join(packDir, archives[0]);
    const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
    if (listing.status !== 0) throw new Error(listing.stderr || `Could not inspect ${workspace}`);
    const files = new Set(
      listing.stdout
        .split("\n")
        .filter(Boolean)
        .map((file) => file.replace(/^package\//, ""))
    );
    if (!files.has("package.json")) throw new Error(`${workspace} package is missing package.json`);
    if (workspace === "@oak-security/aitm" && !files.has("src/aitm.js")) throw new Error("CLI package is missing its executable");
    if (workspace === "@oak-security/aitm-engine" && [...files].some((file) => /electron/i.test(file))) {
      throw new Error("Engine package unexpectedly contains Electron files");
    }
    process.stdout.write(`${workspace}: ${files.size} packaged files\n`);
    fs.unlinkSync(archive);
  }
} finally {
  fs.rmSync(packDir, { recursive: true, force: true });
}
