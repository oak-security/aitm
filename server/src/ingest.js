// Browser ingestion: uploaded files/folders (base64 JSON bodies) are materialized in a
// throwaway temp dir, digested with the core builders, and deleted — mirroring Hive's
// rule that audited source is never persisted per-user; only digests live in projects.
// Repo ingestion reuses the TUI's shallow clone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "./core.js";
import { cloneRepo, repoLabel, isRepoUrl } from "../../tui/src/sources.js";

const MAX_UPLOAD_FILES = 4000;
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024; // decoded, per request

const { appError } = core.util;

// Uploaded relative paths are attacker-controlled: forbid absolute paths, drive
// letters, backslashes, and any ".." segment, then verify confinement after join.
export function sanitizeRel(rel) {
  const s = String(rel || "");
  if (!s || s.includes("\0") || s.includes("\\")) throw appError("bad_path", `Invalid path: ${s.slice(0, 80)}`);
  if (path.posix.isAbsolute(s) || /^[a-zA-Z]:/.test(s)) throw appError("bad_path", `Absolute paths are not allowed: ${s.slice(0, 80)}`);
  const parts = s.split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === "..")) {
    throw appError("bad_path", `Invalid path segment in: ${s.slice(0, 80)}`);
  }
  return parts.join("/");
}

function materialize(root, files) {
  if (!Array.isArray(files) || !files.length) throw appError("bad_input", "No files uploaded.");
  if (files.length > MAX_UPLOAD_FILES) throw appError("too_many_files", `At most ${MAX_UPLOAD_FILES} files per upload.`);
  let bytes = 0;
  for (const f of files) {
    const rel = sanitizeRel(f.rel || f.name);
    const buf = Buffer.from(String(f.dataBase64 || ""), "base64");
    bytes += buf.length;
    if (bytes > MAX_UPLOAD_BYTES) throw appError("too_large", "Upload exceeds the size limit.");
    const dest = path.join(root, rel);
    if (!dest.startsWith(root + path.sep)) throw appError("bad_path", `Path escapes upload root: ${rel}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aitm-web-upload-"));
}

// { files: [{name, dataBase64}] } -> { canceled:false, sources, errors }
export async function ingestFiles(payload) {
  const files = (payload && payload.files) || [];
  const root = tmpRoot();
  try {
    materialize(root, files.map((f) => ({ rel: path.posix.basename(sanitizeRel(f.name)), dataBase64: f.dataBase64 })));
    const sources = [];
    const errors = [];
    for (const f of files) {
      const name = path.posix.basename(sanitizeRel(f.name));
      try {
        const d = await core.digest.buildFileDigest(path.join(root, name));
        d.ref = `upload:${name}`;
        sources.push(d);
      } catch (err) {
        errors.push({ name, message: err.message });
      }
    }
    return { canceled: false, sources, errors };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// { label, files: [{rel, dataBase64}] } -> { canceled:false, source }
export async function ingestFolder(payload) {
  const label = String((payload && payload.label) || "upload").slice(0, 120) || "upload";
  const root = tmpRoot();
  try {
    materialize(root, (payload && payload.files) || []);
    const source = core.digest.buildFolderDigest(root);
    source.label = label;
    source.ref = `upload:${label}`;
    return { canceled: false, source };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// { url } -> { canceled:false, source }
export async function ingestRepo(payload) {
  const url = String((payload && payload.url) || "").trim();
  if (!url || !isRepoUrl(url)) throw appError("bad_input", "Not a git repository URL.");
  // isRepoUrl accepts anything ending in .git, so reject a leading dash before the URL
  // reaches git's argv and is parsed as an option (e.g. --upload-pack=...x.git).
  if (url.startsWith("-")) throw appError("bad_input", "Repository URL may not start with '-'.");
  const clone = cloneRepo(url);
  try {
    const source = core.digest.buildFolderDigest(clone);
    source.label = repoLabel(url);
    source.ref = url;
    return { canceled: false, source };
  } finally {
    fs.rmSync(clone, { recursive: true, force: true });
  }
}
