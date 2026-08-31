"use strict";

const { dialog, BrowserWindow } = require("electron");
const {
  digest: { buildFolderDigest, buildFileDigest },
  util: { appError }
} = require("@oak-security/aitm-engine");

async function pickFolder() {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "Select a source or project folder",
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { canceled: false, source: buildFolderDigest(result.filePaths[0]) };
}

async function pickFiles() {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "Select source or specification files",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Documents & source", extensions: ["md", "markdown", "txt", "pdf", "docx", "json", "yaml", "yml", "toml", "sol", "rs", "go", "ts", "js", "py", "sql", "tf"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const sources = [];
  const errors = [];
  for (const filePath of result.filePaths) {
    try {
      sources.push(await buildFileDigest(filePath));
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }
  if (!sources.length) throw appError("no_sources", `No files could be ingested. ${errors.join(" ")}`);
  return { canceled: false, sources, errors };
}

module.exports = { pickFolder, pickFiles };
