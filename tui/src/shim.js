// Loads AiTM's main-process core outside Electron. Three touchpoints are replaced via
// a Module._load hook installed before any core module loads:
//   - "electron": a fake exposing app.getPath("userData") so the TUI shares the
//     desktop app's project store and settings.json.
//   - src/main/keystore.js: safeStorage is unavailable outside Electron, so keys come
//     from env vars / the TUI's own key file (see keys.js).
//   - src/main/stream.js: emitStream events go to an EventEmitter the TUI renders.
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tuiKeys from "./keys.js";

const require = createRequire(import.meta.url);
const Module = require("node:module");

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const streamBus = new EventEmitter();

export function userDataDir() {
  if (process.env.AITM_DATA_DIR) return process.env.AITM_DATA_DIR;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "AiTM");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "AiTM");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "AiTM");
}

const fakeElectron = {
  app: {
    getPath(name) {
      if (name !== "userData") throw new Error(`aitm-tui electron shim: unsupported path "${name}"`);
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
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return fakeElectron;
    if (request === KEYSTORE) return keystoreShim;
    if (request === STREAM) return streamShim;
    if (parent && parent.filename && request.startsWith(".")) {
      let resolved;
      try {
        resolved = Module._resolveFilename(request, parent);
      } catch {
        resolved = null;
      }
      if (resolved === KEYSTORE) return keystoreShim;
      if (resolved === STREAM) return streamShim;
    }
    return origLoad.apply(this, arguments);
  };
}
