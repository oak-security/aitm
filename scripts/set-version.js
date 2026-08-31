"use strict";

const fs = require("node:fs");
const path = require("node:path");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Usage: npm run version:set -- <semver>");
}

const root = path.join(__dirname, "..");
const manifests = [
  "package.json",
  "packages/engine/package.json",
  "packages/workbench/package.json",
  "packages/cli/package.json"
];
const internal = new Set([
  "@oak-security/aitm-engine",
  "@oak-security/aitm-workbench",
  "@oak-security/aitm"
]);

for (const file of manifests) {
  const absolute = path.join(root, file);
  const manifest = JSON.parse(fs.readFileSync(absolute, "utf8"));
  manifest.version = version;
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const dependency of Object.keys(manifest[section] || {})) {
      if (internal.has(dependency)) manifest[section][dependency] = version;
    }
  }
  fs.writeFileSync(absolute, `${JSON.stringify(manifest, null, 2)}\n`);
}

process.stdout.write(`workspace manifests set to ${version}; run npm install --package-lock-only\n`);
