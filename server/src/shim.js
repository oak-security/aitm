// Loads AiTM's main-process core outside Electron for the local web UI. Same
// Module._load approach and the same three touchpoints as tui/src/shim.js:
//   - "electron": a fake exposing app.getPath("userData") so the web UI shares the
//     desktop app's and the TUI's project store and settings.json.
//   - src/main/keystore.js: safeStorage is Electron-only, so keys come from env vars
//     or the shared non-Electron key file (tui/src/keys.js).
//   - src/main/stream.js: emitStream events go to an EventEmitter the server fans out
//     to connected SSE clients.
// Single-user and single-tenant by design (SPEC.md section 2): the server binds
// loopback, trusts the local user, and holds no accounts, sessions, or per-user dirs.
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tuiKeys from "../../tui/src/keys.js";

const require = createRequire(import.meta.url);
const Module = require("node:module");

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const streamBus = new EventEmitter();

// Twin of tui/src/shim.js userDataDir(); duplicated rather than imported so loading
// this module never pulls in the TUI's own Module._load hook.
export function userDataDir() {
  if (process.env.AITM_DATA_DIR) return process.env.AITM_DATA_DIR;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "AiTM");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "AiTM");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "AiTM");
}

const fakeElectron = {
  app: {
    getPath(name) {
      if (name !== "userData") throw new Error(`aitm-web electron shim: unsupported path "${name}"`);
      const dir = userDataDir();
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => false
  }
};

const keystoreShim = {
  readKey: tuiKeys.readKey,
  setKey: tuiKeys.setKey,
  clearKey: tuiKeys.clearKey,
  status: tuiKeys.status,
  encryptionAvailable: tuiKeys.encryptionAvailable,
  PROVIDERS: tuiKeys.PROVIDERS
};

const streamShim = {
  emitStream(payload) {
    streamBus.emit("stream", payload);
  }
};

let installed = false;

export function installShim() {
  if (installed) return;
  installed = true;
  const KEYSTORE = path.join(ROOT, "src", "main", "keystore.js");
  const STREAM = path.join(ROOT, "src", "main", "stream.js");
  const overrides = { [KEYSTORE]: keystoreShim, [STREAM]: streamShim };
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
