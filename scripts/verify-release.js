"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifests = [
  "package.json",
  "packages/engine/package.json",
  "packages/workbench/package.json",
  "packages/cli/package.json"
];
const packages = manifests.map((file) => ({ file, manifest: JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) }));
const versions = packages.map(({ file, manifest }) => ({ file, version: manifest.version }));
const expected = versions[0].version;
const mismatched = versions.filter(({ version }) => version !== expected);
if (mismatched.length) {
  throw new Error(`Workspace versions differ: ${versions.map(({ file, version }) => `${file}=${version}`).join(", ")}`);
}

const internal = new Set([
  "@oak-security/aitm-engine",
  "@oak-security/aitm-workbench",
  "@oak-security/aitm"
]);
for (const { file, manifest } of packages) {
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [dependency, version] of Object.entries(manifest[section] || {})) {
      if (internal.has(dependency) && version !== expected) {
        throw new Error(`${file} has ${dependency}=${version}; expected ${expected}.`);
      }
    }
  }
}

const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
for (const packagePath of ["", "packages/engine", "packages/workbench", "packages/cli"]) {
  const entry = lock.packages?.[packagePath];
  if (entry?.version !== expected) {
    throw new Error(`package-lock.json has ${packagePath || "root"}=${entry?.version}; expected ${expected}.`);
  }
  for (const [dependency, version] of Object.entries(entry.dependencies || {})) {
    if (internal.has(dependency) && version !== expected) {
      throw new Error(`package-lock.json ${packagePath || "root"} has ${dependency}=${version}; expected ${expected}.`);
    }
  }
}

const tag = process.argv[2] || process.env.GITHUB_REF_NAME || "";
if (tag && tag !== `v${expected}`) {
  throw new Error(`Release tag ${tag} does not match workspace version v${expected}.`);
}

process.stdout.write(`release metadata valid: v${expected}\n`);
