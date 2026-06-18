"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const { appError, assertString } = require("./util");

// The API key lives only here: encrypted at rest via the OS keychain, decrypted in
// memory in the main process only. It is never written to project files, exports,
// logs, or returned to the renderer in plaintext.

function keyFile() {
  return path.join(app.getPath("userData"), "keystore.bin");
}

function encryptionAvailable() {
  return safeStorage.isEncryptionAvailable();
}

function readKey() {
  const file = keyFile();
  if (!fs.existsSync(file)) return "";
  if (!encryptionAvailable()) {
    throw appError("encryption_unavailable", "OS secure storage is unavailable; cannot read the stored API key.");
  }
  try {
    return safeStorage.decryptString(fs.readFileSync(file)).trim();
  } catch {
    throw appError("keystore_corrupt", "Stored API key could not be decrypted. Re-enter it in Settings.");
  }
}

function setKey(key) {
  assertString(key, "API key", { max: 4096 });
  if (!encryptionAvailable()) {
    throw appError("encryption_unavailable", "OS secure storage (Keychain/DPAPI/libsecret) is unavailable. The key cannot be stored securely, so it will not be saved.");
  }
  const trimmed = key.trim();
  fs.writeFileSync(keyFile(), safeStorage.encryptString(trimmed), { mode: 0o600 });
  return status();
}

function clearKey() {
  fs.rmSync(keyFile(), { force: true });
  return status();
}

function status() {
  const file = keyFile();
  const configured = fs.existsSync(file);
  let last4 = "";
  if (configured && encryptionAvailable()) {
    try {
      last4 = readKey().slice(-4);
    } catch {
      /* corrupt; reported via configured + a test() call */
    }
  }
  return { configured, last4, encryptionAvailable: encryptionAvailable() };
}

module.exports = { readKey, setKey, clearKey, status, encryptionAvailable };
