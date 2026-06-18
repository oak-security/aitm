"use strict";

const fs = require("node:fs");
const { ipcMain, dialog, shell, app, BrowserWindow } = require("electron");
const { appError, assertString, assertObject, uuid } = require("../util");

const store = require("../projects/store");
const keystore = require("../keystore");
const settings = require("../settings");
const phases = require("../phases");
const ingest = require("../ingest");
const orchestrate = require("../ai/orchestrate");
const { getAdapter } = require("../ai");
const render = require("../report/render");
const { renderReportPdf, safeDownloadName } = require("../report/pdf");

// Wrap each handler so thrown AppErrors surface a clean { code, message } to the renderer.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return await fn(payload || {});
    } catch (err) {
      const code = err && err.code ? err.code : "error";
      const message = err && err.message ? err.message : "Unexpected error.";
      if (!err || !err.code) console.error(`[ipc:${channel}]`, err);
      throw new Error(`${code}: ${message}`);
    }
  });
}

function requireProject(id) {
  assertString(id, "projectId", { max: 64 });
  return store.get(id);
}

function registerIpc() {
  // ---- projects ----
  handle("projects.list", () => store.list());
  handle("projects.get", ({ id }) => store.get(id));
  handle("projects.create", (input) => store.create(input || {}));
  handle("projects.update", ({ id, patch }) => store.update(id, patch));
  handle("projects.remove", ({ id }) => store.remove(id));
  handle("projects.setActive", ({ id }) => store.setActive(id));
  handle("projects.getActive", () => ({ id: store.getActive() }));
  handle("projects.export", ({ id }) => store.exportProject(id));
  handle("projects.import", ({ json }) => store.importProject(json));

  // ---- keystore ----
  handle("keystore.status", () => keystore.status());
  handle("keystore.set", ({ key }) => keystore.setKey(key));
  handle("keystore.clear", () => keystore.clearKey());
  handle("keystore.test", async () => {
    const key = keystore.readKey();
    if (!key) throw appError("key_missing", "No API key configured.");
    const adapter = getAdapter(settings.get().provider);
    await adapter.validateKey(key);
    return { ok: true };
  });

  // ---- settings ----
  handle("settings.get", () => settings.get());
  handle("settings.set", (patch) => settings.set(patch));

  // ---- phases ----
  handle("phases.registry", ({ classification }) => phases.registry(classification || {}));

  // ---- ingest ----
  handle("ingest.folder", async () => {
    const result = await ingest.pickFolder();
    if (result.canceled) return { canceled: true };
    return { canceled: false, source: result.source };
  });
  handle("ingest.files", async () => {
    const result = await ingest.pickFiles();
    if (result.canceled) return { canceled: true };
    return { canceled: false, sources: result.sources, errors: result.errors };
  });
  handle("ingest.removeSource", ({ projectId, sourceId }) => {
    const project = requireProject(projectId);
    project.sources = (project.sources || []).filter((s) => s.id !== sourceId);
    return store.persist(project);
  });

  // ---- AI orchestration: each call persists results and returns the updated project ----
  handle("ai.classify", async ({ projectId }) => {
    const project = requireProject(projectId);
    const draft = await orchestrate.classify(project);
    project.classification = { ...draft, userOverride: false };
    // Reseed optional phases from the new classification, preserving prior user toggles.
    project.phasesEnabled = phases.seedEnabled(project.classification, project.phasesEnabled);
    project.coordination.enabled = project.phasesEnabled.includes("coordination");
    return store.persist(project);
  });

  handle("ai.traceModel", async ({ projectId }) => {
    const project = requireProject(projectId);
    const draft = await orchestrate.traceModel(project);
    project.traceModel = { ...project.traceModel, ...draft };
    return store.persist(project);
  });

  handle("ai.stride", async ({ projectId }) => {
    const project = requireProject(projectId);
    const draft = await orchestrate.stride(project);
    project.strideThreats = (draft.threats || []).map((t) => ({ id: uuid(), status: "draft", ...t }));
    return store.persist(project);
  });

  handle("ai.attackTree", async ({ projectId, selection }) => {
    const project = requireProject(projectId);
    if (!phases.isEnabled(project, "attack-trees")) throw appError("phase_disabled", "The Attack Trees phase is disabled for this project.");
    const draft = await orchestrate.attackTree(project, selection || {});
    project.attackTrees = [...(project.attackTrees || []), { id: uuid(), ...draft }];
    return store.persist(project);
  });

  handle("ai.coordination", async ({ projectId }) => {
    const project = requireProject(projectId);
    if (!phases.isEnabled(project, "coordination")) throw appError("phase_disabled", "The Coordination phase is disabled for this project.");
    const draft = await orchestrate.coordination(project);
    project.coordination = { enabled: true, scenarios: draft.scenarios || [], notes: draft.notes || "" };
    return store.persist(project);
  });

  handle("ai.report", async ({ projectId }) => {
    const project = requireProject(projectId);
    const enabled = Array.isArray(project.phasesEnabled) ? project.phasesEnabled : [];
    const draft = await orchestrate.report(project, enabled);
    project.report = {
      markdown: draft.markdown || "",
      html: render.toHtml(draft.markdown || "", project.project.name),
      generatedAt: new Date().toISOString()
    };
    return store.persist(project);
  });

  // ---- report PDF export ----
  handle("report.exportPdf", async ({ projectId }) => {
    const project = requireProject(projectId);
    const markdown = project.report && project.report.markdown;
    if (!markdown || !markdown.trim()) throw appError("empty_report", "Generate a report before exporting a PDF.");
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      title: "Export threat model PDF",
      defaultPath: `${safeDownloadName(project.project.name)}-threat-model.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const pdf = await renderReportPdf({ title: project.project.name, markdown, generatedAt: project.report.generatedAt });
    fs.writeFileSync(result.filePath, pdf);
    return { canceled: false, path: result.filePath };
  });

  handle("report.exportMarkdown", async ({ projectId }) => {
    const project = requireProject(projectId);
    const markdown = project.report && project.report.markdown;
    if (!markdown || !markdown.trim()) throw appError("empty_report", "Generate a report before exporting Markdown.");
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      title: "Export threat model Markdown",
      defaultPath: `${safeDownloadName(project.project.name)}-threat-model.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, markdown);
    return { canceled: false, path: result.filePath };
  });

  // ---- app utilities ----
  handle("app.revealDataFolder", () => {
    shell.openPath(app.getPath("userData"));
    return { ok: true };
  });
}

module.exports = { registerIpc };
