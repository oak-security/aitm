// Per-user provider API keys, encrypted at rest with a server-wide secret
// (AES-256-GCM, key derived from the secret via scrypt). Falls back to server-wide
// env keys (OPENAI_API_KEY / ANTHROPIC_API_KEY) when a user has not set their own,
// so an ops-provided shared key works out of the box.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PROVIDERS = ["openai", "anthropic"];
const ENV_KEYS = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
const FILE = "keys.enc";

let secretKey = null;

// Derive the AES key once. The secret comes from AITM_KEY_SECRET or a generated file
// under the data root; rotating it invalidates stored user keys (users re-enter them).
export function initSecret(dataRoot) {
  let secret = (process.env.AITM_KEY_SECRET || "").trim();
  if (!secret) {
    const file = path.join(dataRoot, ".keysecret");
    try {
      secret = fs.readFileSync(file, "utf8").trim();
    } catch {
      secret = crypto.randomBytes(32).toString("hex");
      fs.mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, secret + "\n", { mode: 0o600 });
    }
  }
  secretKey = crypto.scryptSync(secret, "aitm-web-userkeys", 32);
}

function requireSecret() {
  if (!secretKey) throw new Error("userkeys: initSecret() not called");
  return secretKey;
}

function readMap(dir) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));
  } catch {
    return {};
  }
  try {
    const iv = Buffer.from(raw.iv, "base64");
    const tag = Buffer.from(raw.tag, "base64");
    const data = Buffer.from(raw.data, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", requireSecret(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    const map = JSON.parse(plain);
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  } catch {
    return {}; // wrong/rotated secret or corrupt file: treat as no stored keys
  }
}

function writeMap(dir, map) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", requireSecret(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(map), "utf8"), cipher.final()]);
  const payload = JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64")
  });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, FILE), payload, { mode: 0o600 });
}

function normalizeProvider(provider) {
  if (!PROVIDERS.includes(provider)) throw new Error(`Unknown provider: ${provider}`);
  return provider;
}

export function readKey(dir, provider) {
  normalizeProvider(provider);
  const own = (readMap(dir)[provider] || "").trim();
  if (own) return own;
  return (process.env[ENV_KEYS[provider]] || "").trim();
}

export function setKey(dir, provider, key) {
  normalizeProvider(provider);
  const map = readMap(dir);
  map[provider] = String(key).trim();
  writeMap(dir, map);
  return status(dir);
}

export function clearKey(dir, provider) {
  normalizeProvider(provider);
  const map = readMap(dir);
  delete map[provider];
  writeMap(dir, map);
  return status(dir);
}

// Same shape the desktop keystore exposes. encryptionAvailable=true: keys are
// encrypted at rest server-side (with the server secret, not an OS vault).
export function status(dir) {
  const map = readMap(dir);
  const providers = {};
  for (const p of PROVIDERS) {
    const k = (map[p] || process.env[ENV_KEYS[p]] || "").trim();
    providers[p] = { configured: Boolean(k), last4: k ? k.slice(-4) : "" };
  }
  return { encryptionAvailable: true, providers };
}
