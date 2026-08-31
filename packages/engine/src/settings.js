"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertObject } = require("./util");

const DEFAULTS = Object.freeze({
  provider: "openai",
  modelFast: "gpt-5.6-terra",
  modelDeep: "gpt-5.6-sol",
  privacyAcknowledged: false
});

function createSettings(dataDir) {
  if (typeof dataDir !== "string" || !dataDir.trim()) {
    throw new TypeError("createSettings requires a data directory.");
  }
  const settingsFile = path.join(dataDir, "settings.json");

  function get() {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      return { ...DEFAULTS, ...raw };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function set(patch) {
    assertObject(patch, "settings patch");
    const next = { ...get() };
    for (const key of Object.keys(DEFAULTS)) {
      if (key in patch) next[key] = patch[key];
    }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2), { mode: 0o600 });
    return next;
  }

  return Object.freeze({ get, set });
}

module.exports = { createSettings, DEFAULTS };
