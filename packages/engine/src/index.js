"use strict";

const applicationModule = require("./application");
const adapters = require("./ai");
const { createOrchestrate } = require("./ai/orchestrate");
const digest = require("./ingest/digest");
const phases = require("./phases");
const schema = require("./projects/schema");
const { createStore } = require("./projects/store");
const render = require("./report/render");
const reports = require("./report/pdf");
const { createSettings, DEFAULTS } = require("./settings");
const util = require("./util");

function validateKeyStore(keyStore) {
  const methods = ["readKey", "setKey", "clearKey", "status"];
  if (!keyStore || methods.some((method) => typeof keyStore[method] !== "function")) {
    throw new TypeError(`createEngine requires a keyStore adapter with ${methods.join(", ")}.`);
  }
}

function createEngine({ dataDir, keyStore, onEvent = () => {} }) {
  if (typeof dataDir !== "string" || !dataDir.trim()) {
    throw new TypeError("createEngine requires dataDir.");
  }
  validateKeyStore(keyStore);
  if (typeof onEvent !== "function") throw new TypeError("onEvent must be a function.");

  const store = createStore(dataDir);
  const settings = createSettings(dataDir);
  const orchestrate = createOrchestrate({
    getAdapter: adapters.getAdapter,
    keyStore,
    settings,
    emitEvent: onEvent
  });
  const application = applicationModule.createApplication({
    store,
    keystore: keyStore,
    settings,
    phases,
    orchestrate,
    getAdapter: adapters.getAdapter,
    render,
    util
  });

  // The application interface is the primary seam. The grouped capabilities support
  // source ingestion and report downloads without exposing package-internal paths.
  return Object.freeze({
    application,
    ingestion: Object.freeze({ ...digest, scopeFilter: orchestrate.scopeFilter }),
    reports: Object.freeze({ ...reports, toHtml: render.toHtml }),
    cancel: orchestrate.cancelAll,
    dataDir
  });
}

module.exports = {
  createEngine,
  createApplication: applicationModule.createApplication,
  COMMANDS: applicationModule.COMMANDS,
  PIPELINE_STEPS: applicationModule.PIPELINE_STEPS,
  RISK_RANK: applicationModule.RISK_RANK,
  topThreats: applicationModule.topThreats,
  DEFAULTS,
  schema,
  phases,
  digest,
  render,
  reports,
  util,
  adapters
};
