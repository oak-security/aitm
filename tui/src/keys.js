// TUI key store. The desktop app keeps keys in an Electron safeStorage vault the TUI
// cannot decrypt, so the TUI reads keys from the environment first and falls back to
// its own plain-JSON file (chmod 600), mirroring the ~/.hive/hive.conf approach.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PROVIDERS = ["openai", "anthropic"];
const ENV_KEYS = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

export function configDir() {
  if (process.env.AITM_TUI_CONFIG_DIR) return process.env.AITM_TUI_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "aitm-tui");
}

function keyFile() {
  return path.join(configDir(), "keys.json");
}

function readFileMap() {
  try {
    const obj = JSON.parse(fs.readFileSync(keyFile(), "utf8"));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

export function readKey(provider) {
  if (!PROVIDERS.includes(provider)) throw new Error(`Unknown provider: ${provider}`);
  const env = (process.env[ENV_KEYS[provider]] || "").trim();
  if (env) return env;
  return (readFileMap()[provider] || "").trim();
}

export function keySource(provider) {
  if ((process.env[ENV_KEYS[provider]] || "").trim()) return ENV_KEYS[provider];
  if ((readFileMap()[provider] || "").trim()) return keyFile();
  return null;
}

export function setKey(provider, key) {
  if (!PROVIDERS.includes(provider)) throw new Error(`Unknown provider: ${provider}`);
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const map = readFileMap();
  map[provider] = String(key).trim();
  fs.writeFileSync(keyFile(), JSON.stringify(map, null, 2), { mode: 0o600 });
  return status();
}

export function clearKey(provider) {
  const map = readFileMap();
  delete map[provider];
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyFile(), JSON.stringify(map, null, 2), { mode: 0o600 });
  return status();
}

export function encryptionAvailable() {
  return false; // keys live in env vars or a mode-600 file, not an OS vault
}

// Same shape the core keystore exposes: per-provider configured/last4, never the key.
export function status() {
  const providers = {};
  for (const p of PROVIDERS) {
    let k = "";
    try {
      k = readKey(p);
    } catch {
      /* unreachable for known providers */
    }
    providers[p] = { configured: Boolean(k), last4: k ? k.slice(-4) : "" };
  }
  return { encryptionAvailable: false, providers };
}
