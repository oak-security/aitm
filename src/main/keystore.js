"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const { appError, assertString } = require("./util");

// Per-provider API keys. The keystore file holds an encrypted JSON map
// { openai: "...", anthropic: "..." }. Keys live only here: encrypted at rest via the
// OS keychain, decrypted in memory in the main process only. Never written to project
// files, exports, logs, or returned to the renderer in plaintext.

const PROVIDERS = ["openai", "anthropic"];

function keyFile() {
  return path.join(app.getPath("userData"), "keystore.bin");
}

function encryptionAvailable() {
  return safeStorage.isEncryptionAvailable();
}

function readAll() {
  const file = keyFile();
  if (!fs.existsSync(file)) return {};
  if (!encryptionAvailable()) {
    throw appError("encryption_unavailable", "OS secure storage is unavailable; cannot read stored API keys.");
  }
  let plain;
  try {
    plain = safeStorage.decryptString(fs.readFileSync(file));
  } catch {
    throw appError("keystore_corrupt", "Stored API keys could not be decrypted. Re-enter them in Settings.");
  }
  try {
    const obj = JSON.parse(plain);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
  } catch {
    /* fall through to legacy single-key format */
  }
  // Legacy format: a bare key string from the original single-key build → treat as OpenAI.
  return plain.trim() ? { openai: plain.trim() } : {};
}

function writeAll(map) {
  if (!encryptionAvailable()) {
    throw appError("encryption_unavailable", "OS secure storage (Keychain/DPAPI/libsecret) is unavailable. Keys cannot be stored securely, so they will not be saved.");
  }
  fs.writeFileSync(keyFile(), safeStorage.encryptString(JSON.stringify(map)), { mode: 0o600 });
}

function normalizeProvider(provider) {
  assertString(provider, "provider", { max: 32 });
  if (!PROVIDERS.includes(provider)) throw appError("unknown_provider", `Unknown provider: ${provider}`);
  return provider;
}

function readKey(provider) {
  return (readAll()[normalizeProvider(provider)] || "").trim();
}

function setKey(provider, key) {
  normalizeProvider(provider);
  assertString(key, "API key", { max: 4096 });
  const map = readAll();
  map[provider] = key.trim();
  writeAll(map);
  return status();
}

function clearKey(provider) {
  normalizeProvider(provider);
  const map = readAll();
  delete map[provider];
  writeAll(map);
  return status();
}

// Per-provider configured/last4, never the key itself.
function status() {
  const enc = encryptionAvailable();
  let map = {};
  if (enc) {
    try {
      map = readAll();
    } catch {
      /* corrupt; surfaced via a test() call */
    }
  }
  const providers = {};
  for (const p of PROVIDERS) {
    const k = (map[p] || "").trim();
    providers[p] = { configured: Boolean(k), last4: k ? k.slice(-4) : "" };
  }
  return { encryptionAvailable: enc, providers };
}

module.exports = { readKey, setKey, clearKey, status, encryptionAvailable, PROVIDERS };
