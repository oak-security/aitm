"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const { appError, sha256, uuid } = require("../util");

const MAX_FILES = 50000;
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_DOC_BYTES = 50 * 1024 * 1024;
const SAMPLE_COUNT = 18;
const EXCERPT_CHARS = 4000;
const KEEP_PATHS = 200;

// Directories never worth ingesting; skipped regardless of .gitignore.
const SKIP_DIRS = new Set([".git", "node_modules", "vendor", "target", "dist", "build", ".next", ".venv", "__pycache__"]);

// Text-ish extensions we treat as readable source/spec content.
const TEXT_EXTS = new Set([
  ".sol", ".rs", ".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb",
  ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".swift", ".move",
  ".md", ".markdown", ".txt", ".rst", ".adoc",
  ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env.example",
  ".tf", ".hcl", ".proto", ".graphql", ".sql", ".sh", ".dockerfile", ".xml", ".html", ".css"
]);

const DOC_EXTS = new Set([".md", ".markdown", ".txt", ".docx", ".pdf"]);
const MACRO_OFFICE = new Set([".docm", ".xlsm", ".pptm", ".dotm"]);

function stackName(ext) {
  const map = {
    ".sol": "Solidity / EVM", ".rs": "Rust", ".go": "Go", ".move": "Move",
    ".py": "Python", ".java": "Java", ".kt": "Kotlin", ".cs": "C#", ".php": "PHP",
    ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
    ".tf": "Terraform", ".hcl": "HCL", ".sql": "SQL", ".yaml": "YAML", ".yml": "YAML",
    ".md": "Docs", ".markdown": "Docs", ".txt": "Docs"
  };
  return map[ext] || (ext ? ext.slice(1).toUpperCase() : "other");
}

// Minimal .gitignore matcher: supports comments, blank lines, trailing-slash dirs,
// leading-slash anchors, and a single trailing/embedded "*" glob. Not full git spec.
function loadIgnore(root) {
  const file = path.join(root, ".gitignore");
  let patterns = [];
  try {
    patterns = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"));
  } catch {
    /* no .gitignore */
  }
  return patterns.map((raw) => {
    const dirOnly = raw.endsWith("/");
    const body = raw.replace(/\/+$/, "").replace(/^\//, "");
    const re = new RegExp("^" + body.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
    return { re, dirOnly, body };
  });
}

function isIgnored(ignore, relPath, base, isDir) {
  for (const p of ignore) {
    if (p.dirOnly && !isDir) continue;
    if (p.re.test(base) || p.re.test(relPath)) return true;
  }
  return false;
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
  return false;
}

// Confined recursive walk. Never follows symlinks escaping the chosen root.
function buildFolderDigest(root) {
  const realRoot = fs.realpathSync(root);
  const ignore = loadIgnore(realRoot);
  const files = [];
  const stacks = new Map();
  let bytes = 0;
  let count = 0;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(realRoot, full);
      if (entry.isSymbolicLink()) {
        let resolved;
        try {
          resolved = fs.realpathSync(full);
        } catch {
          continue;
        }
        if (!resolved.startsWith(realRoot)) {
          throw appError("symlink_escape", `Folder contains a symlink that escapes the selected directory: ${rel}`);
        }
        continue; // do not traverse symlinks
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (isIgnored(ignore, rel, entry.name, true)) continue;
        walk(full);
      } else if (entry.isFile()) {
        if (isIgnored(ignore, rel, entry.name, false)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_EXTS.has(ext)) continue;
        const stat = fs.statSync(full);
        bytes += stat.size;
        count += 1;
        if (bytes > MAX_BYTES) throw appError("too_large", "Selected folder exceeds the ingestion size limit.");
        if (count > MAX_FILES) throw appError("too_many_files", "Selected folder exceeds the file-count limit.");
        files.push({ rel, ext });
        stacks.set(stackName(ext), (stacks.get(stackName(ext)) || 0) + 1);
      }
    }
  }
  walk(realRoot);

  const sampleFiles = [];
  for (const f of files.slice(0, SAMPLE_COUNT)) {
    try {
      const buf = fs.readFileSync(path.join(realRoot, f.rel));
      if (looksBinary(buf)) continue;
      sampleFiles.push({ path: f.rel, excerpt: buf.toString("utf8").slice(0, EXCERPT_CHARS) });
    } catch {
      /* skip unreadable */
    }
  }

  const paths = files.map((f) => f.rel);
  return {
    id: uuid(),
    type: "folder",
    label: path.basename(realRoot),
    ref: realRoot,
    hash: sha256(realRoot + "\n" + paths.join("\n")),
    summary: `Detected ${paths.length} relevant files. Stacks: ${[...stacks.entries()].map(([k, v]) => `${k} (${v})`).join(", ") || "unknown"}.`,
    stacks: [...stacks.entries()].map(([name, c]) => ({ name, count: c })),
    files: paths.slice(0, KEEP_PATHS),
    sampleFiles,
    warnings: paths.length > KEEP_PATHS ? [`Only the first ${KEEP_PATHS} file paths are retained.`] : []
  };
}

async function buildFileDigest(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (MACRO_OFFICE.has(ext)) throw appError("macro_office", `Macro-enabled Office files are not accepted: ${path.basename(filePath)}`);
  const stat = fs.statSync(filePath);

  if (DOC_EXTS.has(ext)) {
    if (stat.size > MAX_DOC_BYTES) throw appError("doc_too_large", `${path.basename(filePath)} exceeds the document size limit.`);
    const buf = fs.readFileSync(filePath);
    let text = "";
    if (ext === ".docx") text = (await mammoth.extractRawText({ buffer: buf })).value;
    else if (ext === ".pdf") text = (await pdfParse(buf)).text;
    else text = buf.toString("utf8");
    return {
      id: uuid(),
      type: "files",
      label: path.basename(filePath),
      ref: filePath,
      hash: sha256(buf),
      summary: text.replace(/\s+/g, " ").trim().slice(0, 1200),
      excerpt: text.slice(0, 12000),
      warnings: text.trim() ? [] : ["No text could be extracted from this file."]
    };
  }

  if (TEXT_EXTS.has(ext)) {
    if (stat.size > MAX_DOC_BYTES) throw appError("doc_too_large", `${path.basename(filePath)} exceeds the size limit.`);
    const buf = fs.readFileSync(filePath);
    if (looksBinary(buf)) throw appError("binary_file", `${path.basename(filePath)} looks binary and was rejected.`);
    const text = buf.toString("utf8");
    return {
      id: uuid(),
      type: "files",
      label: path.basename(filePath),
      ref: filePath,
      hash: sha256(buf),
      summary: `Source file ${path.basename(filePath)} (${stackName(ext)}).`,
      sampleFiles: [{ path: path.basename(filePath), excerpt: text.slice(0, EXCERPT_CHARS) }],
      files: [path.basename(filePath)],
      warnings: []
    };
  }

  throw appError("unsupported_file", `Unsupported file type: ${path.basename(filePath)}`);
}

module.exports = { buildFolderDigest, buildFileDigest, DOC_EXTS, TEXT_EXTS };
