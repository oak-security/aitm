// RPC channel table mirroring the desktop IPC surface (src/main/ipc/index.js) minus
// the Electron-dialog channels (native ingest pickers, save dialogs, revealDataFolder).
// Handlers run inside the caller's tenant context, so the core store/settings/keystore
// resolve to that user's data dir. Payload validation matches the IPC handlers.
import * as core from "./core.js";

const { store, keystore, settings, phases, orchestrate, getAdapter, render, util } = core;
const { appError, assertString, uuid } = util;

function requireProject(id) {
  assertString(id, "projectId", { max: 64 });
  return store.get(id);
}

// ctx: { uid } (tenant context is already active via runAs); limiter guards ai.* spend.
export function buildHandlers(limiter) {
  const aiCall = (fn) => async (payload, ctx) => {
    const gate = limiter.check(ctx.uid);
    if (!gate.ok) throw appError("rate_limited", gate.message);
    limiter.begin(ctx.uid);
    try {
      return await fn(payload, ctx);
    } finally {
      limiter.end(ctx.uid);
    }
  };

  return {
    "projects.list": () => store.list(),
    "projects.get": ({ id }) => store.get(id),
    "projects.create": (input) => store.create(input || {}),
    "projects.update": ({ id, patch }) => store.update(id, patch),
    "projects.remove": ({ id }) => store.remove(id),
    "projects.setActive": ({ id }) => store.setActive(id),
    "projects.getActive": () => ({ id: store.getActive() }),
    "projects.export": ({ id }) => store.exportProject(id),
    "projects.import": ({ json }) => store.importProject(json),
    "projects.reset": ({ id }) => store.resetAnalysis(id),

    "keystore.status": () => keystore.status(),
    "keystore.set": ({ provider, key }) => keystore.setKey(provider, key),
    "keystore.clear": ({ provider }) => keystore.clearKey(provider),
    "keystore.test": async ({ provider }) => {
      const key = keystore.readKey(provider);
      if (!key) throw appError("key_missing", "No API key configured for this provider.");
      await getAdapter(provider).validateKey(key);
      return { ok: true };
    },

    "settings.get": () => settings.get(),
    "settings.set": (patch) => settings.set(patch),

    "phases.registry": ({ classification }) => phases.registry(classification || {}),

    "ingest.removeSource": ({ projectId, sourceId }) => {
      const project = requireProject(projectId);
      project.sources = (project.sources || []).filter((s) => s.id !== sourceId);
      return store.persist(project);
    },

    "ai.classify": aiCall(async ({ projectId }) => {
      const project = requireProject(projectId);
      const draft = await orchestrate.classify(project);
      project.classification = { ...draft, userOverride: false };
      project.phasesEnabled = phases.seedEnabled(project.classification, project.phasesEnabled);
      project.coordination.enabled = project.phasesEnabled.includes("coordination");
      return store.persist(project);
    }),

    "ai.traceModel": aiCall(async ({ projectId }) => {
      const project = requireProject(projectId);
      const draft = await orchestrate.traceModel(project);
      project.traceModel = { ...project.traceModel, ...draft };
      return store.persist(project);
    }),

    "ai.stride": aiCall(async ({ projectId }) => {
      const project = requireProject(projectId);
      const draft = await orchestrate.stride(project);
      project.strideThreats = (draft.threats || []).map((t) => ({ id: uuid(), status: "draft", ...t }));
      return store.persist(project);
    }),

    "ai.attackTree": aiCall(async ({ projectId, selection }) => {
      let project = requireProject(projectId);
      if (!phases.isEnabled(project, "attack-trees")) throw appError("phase_disabled", "The Attack Trees phase is disabled for this project.");
      const existing = new Set((project.attackTrees || []).map((t) => t.threatId).filter(Boolean));
      const ids = ((selection && selection.threatIds) || []).filter((id) => id && !existing.has(id));
      if (!ids.length) throw appError("no_threats", "Select at least one threat that does not already have an attack tree.");
      for (const threatId of ids) {
        const draft = await orchestrate.attackTree(project, threatId);
        project.attackTrees.push({ id: uuid(), threatId, ...draft });
        project = store.persist(project);
      }
      return project;
    }),

    "ai.coordination": aiCall(async ({ projectId }) => {
      const project = requireProject(projectId);
      if (!phases.isEnabled(project, "coordination")) throw appError("phase_disabled", "The Coordination phase is disabled for this project.");
      const draft = await orchestrate.coordination(project);
      project.coordination = { enabled: true, scenarios: draft.scenarios || [], notes: draft.notes || "" };
      return store.persist(project);
    }),

    "ai.report": aiCall(async ({ projectId }) => {
      const project = requireProject(projectId);
      const enabled = Array.isArray(project.phasesEnabled) ? project.phasesEnabled : [];
      const draft = await orchestrate.report(project, enabled);
      project.report = {
        markdown: draft.markdown || "",
        html: render.toHtml(draft.markdown || "", project.project.name),
        generatedAt: new Date().toISOString()
      };
      return store.persist(project);
    }),

    "ai.cancel": (_payload, ctx) => orchestrate.cancelAll(ctx.uid)
  };
}
