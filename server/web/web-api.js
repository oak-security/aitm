// Browser replacement for the Electron preload: defines the same window.api surface,
// backed by POST /api/rpc (per-channel), SSE for ai.onStream, browser file pickers +
// uploads for ingestion, and streamed downloads for report export. Response and error
// shapes match the IPC contract, so app.js runs unchanged.
(() => {
  "use strict";

  // Hosted mode: the server owns a single OpenAI key (from .env) and forces the
  // provider/model, so the renderer hides the Settings screen and key gating.
  window.AITM_HOSTED = true;

  async function rpc(channel, payload) {
    const res = await fetch("/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, payload: payload === undefined ? {} : payload })
    });
    if (res.status === 401) {
      location.href = "/";
      throw new Error("unauthenticated: Session expired.");
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (body && body.error) || {};
      throw new Error(`${e.code || "error"}: ${e.message || "Request failed."}`);
    }
    return body.result;
  }

  async function post(path, payload) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.status === 401) {
      location.href = "/";
      throw new Error("unauthenticated: Session expired.");
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (body && body.error) || {};
      throw new Error(`${e.code || "error"}: ${e.message || "Request failed."}`);
    }
    return body;
  }

  // ---- ingestion pickers -------------------------------------------------

  // Mirrors src/main/ingest/digest.js TEXT_EXTS/DOC_EXTS and SKIP_DIRS so folder
  // uploads carry only what the digest would keep anyway.
  const TEXT_EXTS = new Set([
    ".sol", ".rs", ".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb",
    ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".swift", ".move",
    ".md", ".markdown", ".txt", ".rst", ".adoc",
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".tf", ".hcl", ".proto", ".graphql", ".sql", ".sh", ".dockerfile", ".xml", ".html", ".css"
  ]);
  const DOC_EXTS = new Set([".md", ".markdown", ".txt", ".docx", ".pdf"]);
  const SKIP_DIRS = new Set([".git", "node_modules", "vendor", "target", "dist", "build", ".next", ".venv", "__pycache__"]);
  const MAX_FOLDER_FILES = 4000;
  const MAX_UPLOAD_BYTES = 96 * 1024 * 1024;

  function ext(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
  }

  function pick({ directory = false, multiple = false, accept = "" } = {}) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      if (directory) input.webkitdirectory = true;
      if (multiple) input.multiple = true;
      if (accept) input.accept = accept;
      input.style.display = "none";
      document.body.appendChild(input);
      const done = (files) => {
        input.remove();
        resolve(files);
      };
      input.addEventListener("change", () => done([...input.files]));
      input.addEventListener("cancel", () => done(null));
      input.click();
    });
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",", 2)[1] || "");
      r.onerror = () => reject(new Error(`Could not read ${file.name}`));
      r.readAsDataURL(file);
    });
  }

  async function ingestFolder() {
    const picked = await pick({ directory: true });
    if (!picked) return { canceled: true };
    const kept = [];
    let bytes = 0;
    let label = "upload";
    for (const f of picked) {
      const rel = f.webkitRelativePath || f.name;
      const parts = rel.split("/");
      if (parts.length > 1) label = parts[0];
      const inner = parts.slice(1); // strip the picked root; digest labels carry it
      if (inner.some((p) => SKIP_DIRS.has(p) )) continue;
      if (!TEXT_EXTS.has(ext(f.name))) continue;
      if (kept.length >= MAX_FOLDER_FILES) break;
      bytes += f.size;
      if (bytes > MAX_UPLOAD_BYTES) throw new Error("too_large: Folder exceeds the upload size limit; use a git URL instead.");
      kept.push({ rel: inner.join("/") || f.name, file: f });
    }
    if (!kept.length) throw new Error("no_files: No ingestible text files in the selected folder.");
    const files = [];
    for (const k of kept) files.push({ rel: k.rel, dataBase64: await toBase64(k.file) });
    return post("/api/ingest/folder", { label, files });
  }

  async function ingestFiles() {
    const accept = [...new Set([...DOC_EXTS, ...TEXT_EXTS])].join(",");
    const picked = await pick({ multiple: true, accept });
    if (!picked || !picked.length) return { canceled: true };
    let bytes = 0;
    const files = [];
    for (const f of picked) {
      bytes += f.size;
      if (bytes > MAX_UPLOAD_BYTES) throw new Error("too_large: Selection exceeds the upload size limit.");
      files.push({ name: f.name, dataBase64: await toBase64(f) });
    }
    return post("/api/ingest/files", { files });
  }

  // ---- report downloads --------------------------------------------------

  async function download(kind, projectId) {
    const res = await fetch(`/api/report/${kind}?projectId=${encodeURIComponent(projectId)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const e = (body && body.error) || {};
      throw new Error(`${e.code || "error"}: ${e.message || "Export failed."}`);
    }
    const name = (res.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || `report.${kind}`;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { canceled: false, path: name };
  }

  // ---- the window.api surface (matches src/preload/index.js) --------------

  window.api = {
    projects: {
      list: () => rpc("projects.list"),
      get: (id) => rpc("projects.get", { id }),
      create: (input) => rpc("projects.create", input),
      update: (id, patch) => rpc("projects.update", { id, patch }),
      remove: (id) => rpc("projects.remove", { id }),
      setActive: (id) => rpc("projects.setActive", { id }),
      getActive: () => rpc("projects.getActive"),
      export: (id) => rpc("projects.export", { id }),
      import: (json) => rpc("projects.import", { json }),
      reset: (id) => rpc("projects.reset", { id })
    },
    keystore: {
      status: () => rpc("keystore.status"),
      set: (provider, key) => rpc("keystore.set", { provider, key }),
      clear: (provider) => rpc("keystore.clear", { provider }),
      test: (provider) => rpc("keystore.test", { provider })
    },
    settings: {
      get: () => rpc("settings.get"),
      set: (patch) => rpc("settings.set", patch)
    },
    phases: {
      registry: (classification) => rpc("phases.registry", { classification })
    },
    ingest: {
      folder: ingestFolder,
      files: ingestFiles,
      repo: (url) => post("/api/ingest/repo", { url }),
      removeSource: (projectId, sourceId) => rpc("ingest.removeSource", { projectId, sourceId })
    },
    ai: {
      classify: (projectId) => rpc("ai.classify", { projectId }),
      traceModel: (projectId) => rpc("ai.traceModel", { projectId }),
      stride: (projectId) => rpc("ai.stride", { projectId }),
      attackTree: (projectId, selection) => rpc("ai.attackTree", { projectId, selection }),
      coordination: (projectId) => rpc("ai.coordination", { projectId }),
      report: (projectId) => rpc("ai.report", { projectId }),
      cancel: () => rpc("ai.cancel"),
      onStream: (cb) => {
        const es = new EventSource("/api/stream");
        es.onmessage = (m) => {
          try {
            cb(JSON.parse(m.data));
          } catch {
            /* ignore malformed frames */
          }
        };
        return () => es.close();
      }
    },
    report: {
      exportPdf: (projectId) => download("pdf", projectId),
      exportMarkdown: (projectId) => download("md", projectId)
    }
    // no `app` namespace: the renderer feature-detects it (reveal-folder is desktop-only)
  };

  // ---- signed-in badge -----------------------------------------------------

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const res = await fetch("/auth/me");
      if (!res.ok) return;
      const { user, bypass } = await res.json();
      const badge = document.createElement("div");
      badge.style.cssText =
        "position:fixed;top:10px;right:12px;z-index:60;font-size:12px;color:#6f747a;" +
        "background:rgba(247,246,245,.92);border:1px solid #e3e1de;border-radius:999px;padding:4px 12px";
      badge.append(`@${user.login}${bypass ? " · auth bypass" : ""} · `);
      const out = document.createElement("a");
      out.textContent = "sign out";
      out.href = "/auth/logout";
      out.style.cssText = "color:#9C0069;cursor:pointer;text-decoration:none";
      badge.appendChild(out);
      document.body.appendChild(badge);
    } catch {
      /* badge is cosmetic */
    }
  });
})();
