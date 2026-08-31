"use strict";

const fs = require("node:fs");
const { ipcMain, dialog, shell, app, BrowserWindow } = require("electron");
const {
  util: { appError, assertString }
} = require("@oak-security/aitm-engine");
const { getRuntime } = require("../runtime");
const ingest = require("../ingest");

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

function requireProject(application, id) {
  assertString(id, "projectId", { max: 64 });
  return application.execute("projects.get", { id });
}

function registerIpc() {
  const runtime = getRuntime();
  const { application } = runtime;
  const { renderReportPdf, safeDownloadName } = runtime.reports;
  // Shared project, settings, key, and pipeline commands. HTTP, TUI, and CLI use
  // this same application interface through their own adapters.
  for (const channel of application.commands) {
    handle(channel, (payload) => application.execute(channel, payload));
  }

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
  // ---- report PDF export ----
  handle("report.exportPdf", async ({ projectId }) => {
    const project = requireProject(application, projectId);
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
    const project = requireProject(application, projectId);
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
