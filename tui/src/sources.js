// Target resolution and ingestion for the TUI. Local dirs/files reuse the core digest
// builders directly (no Electron dialogs); GitHub/git URLs are shallow-cloned to a temp
// dir, digested, and the clone removed. A scope hint reduces a directory target to the
// AI-selected sub-paths, each digested as its own source.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SKIP_DIRS = new Set([".git", "node_modules", "vendor", "target", "dist", "build", ".next", ".venv", "__pycache__"]);

export function isRepoUrl(arg) {
  return /^https?:\/\//i.test(arg) || /^git@[^:]+:/.test(arg) || /\.git$/.test(arg);
}

export function repoLabel(url) {
  const m = String(url).match(/([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : url;
}

// argv (after flags) → [{ kind: "repo"|"dir"|"file", ref }]; no args → cwd.
export function resolveTargets(args) {
  if (!args.length) return [{ kind: "dir", ref: process.cwd() }];
  return args.map((arg) => {
    if (isRepoUrl(arg)) return { kind: "repo", ref: arg };
    const abs = path.resolve(arg);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new Error(`No such file or directory: ${arg}`);
    }
    return { kind: stat.isDirectory() ? "dir" : "file", ref: abs };
  });
}

export function cloneRepo(url) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aitm-tui-clone-"));
  const res = spawnSync("git", ["clone", "--depth", "1", "--single-branch", url, tmp], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300000
  });
  if (res.status !== 0) {
    fs.rmSync(tmp, { recursive: true, force: true });
    const err = (res.stderr || "").toString().trim().split("\n").pop() || "git clone failed";
    throw new Error(`Clone failed for ${url}: ${err}`);
  }
  return tmp;
}

// Directory names (relative), depth-limited, for the scope-filter prompt.
export function listDirs(root, maxDepth = 4, cap = 400) {
  const out = [];
  function walk(dir, depth) {
    if (depth > maxDepth || out.length >= cap) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= cap) return;
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      out.push(path.relative(root, full));
      walk(full, depth + 1);
    }
  }
  walk(root, 1);
  return out;
}

// Digest a directory target, optionally reduced by a scope hint. Returns a list of
// sources: the whole-root digest, or one digest per AI-included sub-path.
export async function digestDir({ root, label, ref, scopeHint, digest, orchestrate, onLog }) {
  const whole = digest.buildFolderDigest(root);
  if (label) whole.label = label;
  if (ref) whole.ref = ref;
  if (!scopeHint) return { sources: [whole], reduced: false };

  onLog(`Applying scope hint to ${whole.label}…`);
  const dirs = listDirs(root);
  const { include, note } = await orchestrate.scopeFilter({
    hint: scopeHint,
    dirs,
    files: whole.files || []
  });
  const picks = [...new Set((include || []).map((p) => String(p).replace(/^\.?\//, "").replace(/\/+$/, "")).filter(Boolean))];
  if (!picks.length) {
    if (note) onLog(`Scope hint kept everything: ${note}`);
    return { sources: [whole], reduced: false };
  }

  const sources = [];
  for (const rel of picks) {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(path.resolve(root) + path.sep) && abs !== path.resolve(root)) {
      onLog(`Skipped out-of-root scope path: ${rel}`);
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      onLog(`Skipped missing scope path: ${rel}`);
      continue;
    }
    try {
      if (stat.isDirectory()) {
        const d = digest.buildFolderDigest(abs);
        d.label = `${whole.label}/${rel}`;
        if (ref) d.ref = `${ref} → ${rel}`;
        sources.push(d);
      } else {
        const d = await digest.buildFileDigest(abs);
        if (ref) d.ref = `${ref} → ${rel}`;
        sources.push(d);
      }
    } catch (err) {
      onLog(`Skipped ${rel}: ${err.message}`);
    }
  }
  if (!sources.length) {
    onLog("Scope hint matched nothing usable; ingesting everything.");
    return { sources: [whole], reduced: false };
  }
  return { sources, reduced: true, note: note || "" };
}

// Ingest all targets. onLog receives human-readable progress lines.
export async function ingestTargets(targets, { scopeHint, digest, orchestrate, onLog }) {
  const sources = [];
  for (const t of targets) {
    if (t.kind === "file") {
      onLog(`Reading ${path.basename(t.ref)}…`);
      sources.push(await digest.buildFileDigest(t.ref));
    } else if (t.kind === "dir") {
      onLog(`Scanning ${t.ref}…`);
      const res = await digestDir({ root: t.ref, scopeHint, digest, orchestrate, onLog });
      sources.push(...res.sources);
    } else {
      onLog(`Cloning ${t.ref}…`);
      const tmp = cloneRepo(t.ref);
      try {
        onLog(`Scanning ${repoLabel(t.ref)}…`);
        const res = await digestDir({
          root: tmp,
          label: repoLabel(t.ref),
          ref: t.ref,
          scopeHint,
          digest,
          orchestrate,
          onLog
        });
        sources.push(...res.sources);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  }
  return sources;
}

export function defaultProjectName(targets) {
  const first = targets[0];
  const base = first.kind === "repo" ? repoLabel(first.ref) : path.basename(first.ref) || first.ref;
  return targets.length > 1 ? `${base} +${targets.length - 1}` : base;
}
