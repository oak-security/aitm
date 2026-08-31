import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import * as keys from "./tui/keys.js";

const require = createRequire(import.meta.url);
const { createEngine, schema, phases, adapters, util, RISK_RANK, topThreats } = require("@oak-security/aitm-engine");

export function userDataDir() {
  if (process.env.AITM_DATA_DIR) return path.resolve(process.env.AITM_DATA_DIR);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "AiTM");
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "AiTM");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "AiTM");
}

export const streamBus = new EventEmitter();
export const engine = createEngine({
  dataDir: userDataDir(),
  keyStore: keys,
  onEvent: (payload) => streamBus.emit("stream", payload)
});

export const application = Object.freeze({
  ...engine.application,
  COMMANDS: engine.application.commands,
  RISK_RANK,
  topThreats
});
export const store = {
  list: () => application.execute("projects.list"),
  get: (id) => application.execute("projects.get", { id }),
  create: (input) => application.execute("projects.create", input),
  persist: (project) => application.execute("projects.update", { id: project.project.id, patch: project }),
  remove: (id) => application.execute("projects.remove", { id })
};
export const settings = {
  get: () => application.execute("settings.get"),
  set: (patch) => application.execute("settings.set", patch)
};
export const orchestrate = {
  scopeFilter: engine.ingestion.scopeFilter,
  cancelAll: engine.cancel
};
export const digest = engine.ingestion;
export const renderReportPdf = engine.reports.renderReportPdf;
export const safeDownloadName = engine.reports.safeDownloadName;
export const getAdapter = adapters.getAdapter;
export { schema, phases, util };
