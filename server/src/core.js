// Bridge to AiTM's main-process core (see tui/src/core.js for the terminal twin).
// The shim must install before the first core require so the Electron touchpoints
// resolve to the web server's replacements.
import { createRequire } from "node:module";
import path from "node:path";
import { installShim, streamBus, userDataDir, ROOT } from "./shim.js";

installShim();

const require = createRequire(import.meta.url);
const core = (p) => require(path.join(ROOT, "src", "main", p));

export const orchestrate = core("ai/orchestrate.js");
export const { getAdapter } = core("ai/index.js");
export const store = core("projects/store.js");
export const schema = core("projects/schema.js");
export const settings = core("settings.js");
export const phases = core("phases.js");
export const digest = core("ingest/digest.js");
export const keystore = core("keystore.js"); // resolves to the shim (env vars / key file)
export const render = core("report/render.js");
export const { renderReportPdf, safeDownloadName } = core("report/pdf.js");
export const util = core("util.js");

export { streamBus, userDataDir, ROOT };
