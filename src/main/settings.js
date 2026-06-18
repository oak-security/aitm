"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { assertObject } = require("./util");

const DEFAULTS = {
  provider: "openai",
  modelFast: "gpt-5-mini",
  modelDeep: "gpt-5.5",
  privacyAcknowledged: false
};

function file() {
  return path.join(app.getPath("userData"), "settings.json");
}

function get() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
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
  fs.writeFileSync(file(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

module.exports = { get, set, DEFAULTS };
