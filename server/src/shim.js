// Loads AiTM's main-process core outside Electron for multi-tenant serving. Same
// Module._load approach as tui/src/shim.js, but every replaced touchpoint resolves
// through AsyncLocalStorage: each HTTP request runs inside a tenant context
// { uid, dir, emit }, so app.getPath("userData") returns that user's private data dir,
// keystore reads that user's encrypted key file (env fallback), and emitStream routes
// to that user's SSE connections. Tenant isolation is physical (one directory per
// GitHub identity), not a route-layer ownership map.
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as userkeys from "./userkeys.js";

const require = createRequire(import.meta.url);
const Module = require("node:module");

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const als = new AsyncLocalStorage();

export function ctx() {
  const c = als.getStore();
  if (!c) throw new Error("aitm-web: core call outside a tenant context");
  return c;
}

export function runAs(context, fn) {
  return als.run(context, fn);
}

const fakeElectron = {
  app: {
    getPath(name) {
      if (name !== "userData") throw new Error(`aitm-web electron shim: unsupported path "${name}"`);
      const dir = ctx().dir;
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      return dir;
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => false
  }
};

const keystoreShim = {
  readKey: (provider) => userkeys.readKey(ctx().dir, provider),
  setKey: (provider, key) => userkeys.setKey(ctx().dir, provider, key),
  clearKey: (provider) => userkeys.clearKey(ctx().dir, provider),
  status: () => userkeys.status(ctx().dir),
  encryptionAvailable: () => true,
  PROVIDERS: userkeys.PROVIDERS
};

const streamShim = {
  emitStream(payload) {
    const c = als.getStore();
    if (c && typeof c.emit === "function") c.emit(payload);
  }
};

// Hosted mode is OpenAI-only: the server forces the provider and models so both the
// orchestrator (which reads core settings) and the RPC layer are consistent, and no
// stored per-user settings can switch providers. Models are env-configurable.
function hostedSettings() {
  return {
    provider: "openai",
    modelFast: (process.env.AITM_MODEL_FAST || "gpt-5-mini").trim(),
    modelDeep: (process.env.AITM_MODEL_DEEP || "gpt-5.5").trim(),
    privacyAcknowledged: true
  };
}
const settingsShim = {
  DEFAULTS: hostedSettings(),
  get: hostedSettings,
  set: () => hostedSettings()
};

let installed = false;

export function installShim() {
  if (installed) return;
  installed = true;
  const KEYSTORE = path.join(ROOT, "src", "main", "keystore.js");
  const STREAM = path.join(ROOT, "src", "main", "stream.js");
  const SETTINGS = path.join(ROOT, "src", "main", "settings.js");
  const overrides = { [KEYSTORE]: keystoreShim, [STREAM]: streamShim, [SETTINGS]: settingsShim };
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return fakeElectron;
    // Match both relative requires from within src/main (orchestrate -> ../keystore)
    // and absolute requires from core.js (require(ROOT/src/main/keystore.js)).
    if (overrides[request]) return overrides[request];
    if (parent && parent.filename && request.startsWith(".")) {
      let resolved;
      try {
        resolved = Module._resolveFilename(request, parent);
      } catch {
        resolved = null;
      }
      if (overrides[resolved]) return overrides[resolved];
    }
    return origLoad.apply(this, arguments);
  };
}
