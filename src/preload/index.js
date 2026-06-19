"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

// Typed surface exposed to the renderer. No raw ipcRenderer, no Node globals leak.
contextBridge.exposeInMainWorld("api", {
  projects: {
    list: () => invoke("projects.list"),
    get: (id) => invoke("projects.get", { id }),
    create: (input) => invoke("projects.create", input),
    update: (id, patch) => invoke("projects.update", { id, patch }),
    remove: (id) => invoke("projects.remove", { id }),
    setActive: (id) => invoke("projects.setActive", { id }),
    getActive: () => invoke("projects.getActive"),
    export: (id) => invoke("projects.export", { id }),
    import: (json) => invoke("projects.import", { json })
  },
  keystore: {
    status: () => invoke("keystore.status"),
    set: (provider, key) => invoke("keystore.set", { provider, key }),
    clear: (provider) => invoke("keystore.clear", { provider }),
    test: (provider) => invoke("keystore.test", { provider })
  },
  settings: {
    get: () => invoke("settings.get"),
    set: (patch) => invoke("settings.set", patch)
  },
  phases: {
    registry: (classification) => invoke("phases.registry", { classification })
  },
  ingest: {
    folder: () => invoke("ingest.folder"),
    files: () => invoke("ingest.files"),
    removeSource: (projectId, sourceId) => invoke("ingest.removeSource", { projectId, sourceId })
  },
  ai: {
    classify: (projectId) => invoke("ai.classify", { projectId }),
    traceModel: (projectId) => invoke("ai.traceModel", { projectId }),
    stride: (projectId) => invoke("ai.stride", { projectId }),
    attackTree: (projectId, selection) => invoke("ai.attackTree", { projectId, selection }),
    coordination: (projectId) => invoke("ai.coordination", { projectId }),
    report: (projectId) => invoke("ai.report", { projectId }),
    cancel: () => invoke("ai.cancel"),
    // Subscribe to streaming events ({ event, label, text, message }). Returns an unsubscribe.
    onStream: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on("ai:stream", listener);
      return () => ipcRenderer.removeListener("ai:stream", listener);
    }
  },
  report: {
    exportPdf: (projectId) => invoke("report.exportPdf", { projectId }),
    exportMarkdown: (projectId) => invoke("report.exportMarkdown", { projectId })
  },
  app: {
    revealDataFolder: () => invoke("app.revealDataFolder")
  }
});
