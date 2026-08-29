"use strict";

// Transport-neutral application module. Electron IPC, HTTP RPC, the TUI, and the
// headless CLI all cross this seam so project mutations and TRACE pipeline behavior
// are defined once.

const RISK_RANK = Object.freeze({
  Critical: 5,
  High: 4,
  Medium: 3,
  Low: 2,
  Informational: 1,
  "N/A": 0
});

const PIPELINE_STEPS = Object.freeze([
  Object.freeze({ id: "classify", title: "Classify" }),
  Object.freeze({ id: "trace-model", title: "TRACE model" }),
  Object.freeze({ id: "stride", title: "STRIDE" }),
  Object.freeze({ id: "attack-trees", title: "Attack trees", optional: true }),
  Object.freeze({ id: "coordination", title: "Coordination", optional: true }),
  Object.freeze({ id: "report", title: "Report" })
]);

const COMMANDS = Object.freeze([
  "projects.list",
  "projects.get",
  "projects.create",
  "projects.update",
  "projects.remove",
  "projects.setActive",
  "projects.getActive",
  "projects.export",
  "projects.import",
  "projects.reset",
  "keystore.status",
  "keystore.set",
  "keystore.clear",
  "keystore.test",
  "settings.get",
  "settings.set",
  "phases.registry",
  "ingest.removeSource",
  "ai.classify",
  "ai.traceModel",
  "ai.stride",
  "ai.attackTree",
  "ai.coordination",
  "ai.report",
  "ai.cancel",
  "pipeline.step",
  "pipeline.run"
]);

function topThreats(threats, limit) {
  return (threats || [])
    .filter((threat) => threat.isApplicable !== false)
    .slice()
    .sort((a, b) => (RISK_RANK[b.risk] || 0) - (RISK_RANK[a.risk] || 0))
    .slice(0, limit);
}

function createApplication(deps) {
  const { store, keystore, settings, phases, orchestrate, getAdapter, render, util } = deps;
  const { appError, assertString, uuid } = util;

  function requireProject(id) {
    assertString(id, "projectId", { max: 64 });
    return store.get(id);
  }

  function attackTreeLimit(value) {
    const limit = value === undefined ? 3 : value;
    if (!Number.isInteger(limit) || limit < 0 || limit > 100) {
      throw appError("bad_input", "attackTreeLimit must be an integer from 0 to 100.");
    }
    return limit;
  }

  const handlers = {
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
      project.sources = (project.sources || []).filter((source) => source.id !== sourceId);
      return store.persist(project);
    },

    "ai.classify": async ({ projectId }) => {
      const project = requireProject(projectId);
      const draft = await orchestrate.classify(project);
      project.classification = { ...draft, userOverride: false };
      project.phasesEnabled = phases.seedEnabled(project.classification, project.phasesEnabled);
      project.coordination.enabled = project.phasesEnabled.includes("coordination");
      return store.persist(project);
    },

    "ai.traceModel": async ({ projectId }) => {
      const project = requireProject(projectId);
      const draft = await orchestrate.traceModel(project);
      project.traceModel = { ...project.traceModel, ...draft };
      return store.persist(project);
    },

    "ai.stride": async ({ projectId }) => {
      const project = requireProject(projectId);
      const draft = await orchestrate.stride(project);
      project.strideThreats = (draft.threats || []).map((threat) => ({ id: uuid(), status: "draft", ...threat }));
      return store.persist(project);
    },

    "ai.attackTree": async ({ projectId, selection }) => {
      let project = requireProject(projectId);
      if (!phases.isEnabled(project, "attack-trees")) {
        throw appError("phase_disabled", "The Attack Trees phase is disabled for this project.");
      }
      const existing = new Set((project.attackTrees || []).map((tree) => tree.threatId).filter(Boolean));
      const ids = ((selection && selection.threatIds) || []).filter((id) => id && !existing.has(id));
      if (!ids.length) {
        throw appError("no_threats", "Select at least one threat that does not already have an attack tree.");
      }
      for (const threatId of ids) {
        const draft = await orchestrate.attackTree(project, threatId);
        project.attackTrees.push({ id: uuid(), threatId, ...draft });
        project = store.persist(project);
      }
      return project;
    },

    "ai.coordination": async ({ projectId }) => {
      const project = requireProject(projectId);
      if (!phases.isEnabled(project, "coordination")) {
        throw appError("phase_disabled", "The Coordination phase is disabled for this project.");
      }
      const draft = await orchestrate.coordination(project);
      project.coordination = { enabled: true, scenarios: draft.scenarios || [], notes: draft.notes || "" };
      return store.persist(project);
    },

    "ai.report": async ({ projectId }) => {
      const project = requireProject(projectId);
      const enabled = Array.isArray(project.phasesEnabled) ? project.phasesEnabled : [];
      const draft = await orchestrate.report(project, enabled);
      project.report = {
        markdown: draft.markdown || "",
        html: render.toHtml(draft.markdown || "", project.project.name),
        generatedAt: new Date().toISOString()
      };
      return store.persist(project);
    },

    "ai.cancel": () => orchestrate.cancelAll(),
    "pipeline.step": ({ projectId, step, options }) => runStep(projectId, step, options),
    "pipeline.run": ({ projectId, reset, attackTreeLimit }) => runPipeline(projectId, { reset, attackTreeLimit })
  };

  async function execute(command, payload = {}) {
    const handler = handlers[command];
    if (!handler) throw appError("no_command", `Unknown application command: ${String(command).slice(0, 80)}`);
    return handler(payload || {});
  }

  async function runStep(projectId, stepId, options = {}) {
    const step = PIPELINE_STEPS.find((candidate) => candidate.id === stepId);
    if (!step) throw appError("bad_step", `Unknown pipeline step: ${String(stepId).slice(0, 80)}`);

    let project = requireProject(projectId);
    if (stepId === "attack-trees") {
      if (!phases.isEnabled(project, "attack-trees")) return { step, status: "skipped", project };
      const existing = new Set((project.attackTrees || []).map((tree) => tree.threatId).filter(Boolean));
      const selected = Array.isArray(options.threatIds)
        ? (project.strideThreats || []).filter((threat) => options.threatIds.includes(threat.id))
        : topThreats((project.strideThreats || []).filter((threat) => !existing.has(threat.id)), attackTreeLimit(options.attackTreeLimit));
      const threatIds = selected.map((threat) => threat.id).filter((id) => !existing.has(id));
      if (!threatIds.length) return { step, status: "skipped", project };
      project = await execute("ai.attackTree", { projectId, selection: { threatIds } });
      return { step, status: "completed", project };
    }
    if (stepId === "coordination" && !phases.isEnabled(project, "coordination")) {
      return { step, status: "skipped", project };
    }

    const command = {
      classify: "ai.classify",
      "trace-model": "ai.traceModel",
      stride: "ai.stride",
      coordination: "ai.coordination",
      report: "ai.report"
    }[stepId];
    project = await execute(command, { projectId });
    return { step, status: "completed", project };
  }

  async function runPipeline(projectId, options = {}) {
    if (options.reset !== undefined && typeof options.reset !== "boolean") {
      throw appError("bad_input", "reset must be a boolean.");
    }
    const treeLimit = attackTreeLimit(options.attackTreeLimit);
    if (options.reset) await execute("projects.reset", { id: projectId });
    const results = [];
    let project = requireProject(projectId);
    for (const step of PIPELINE_STEPS) {
      if (options.onStep) await options.onStep({ event: "started", step, project });
      const result = await runStep(projectId, step.id, { attackTreeLimit: treeLimit });
      project = result.project;
      results.push({ step: step.id, status: result.status });
      if (options.onStep) await options.onStep({ event: result.status, step, project });
    }
    return { project, steps: results };
  }

  return Object.freeze({ execute, runStep, runPipeline, commands: COMMANDS, steps: PIPELINE_STEPS });
}

let defaultApplication;

function getDefaultApplication() {
  if (!defaultApplication) {
    defaultApplication = createApplication({
      store: require("./projects/store"),
      keystore: require("./keystore"),
      settings: require("./settings"),
      phases: require("./phases"),
      orchestrate: require("./ai/orchestrate"),
      getAdapter: require("./ai").getAdapter,
      render: require("./report/render"),
      util: require("./util")
    });
  }
  return defaultApplication;
}

module.exports = {
  COMMANDS,
  PIPELINE_STEPS,
  RISK_RANK,
  topThreats,
  createApplication,
  execute: (...args) => getDefaultApplication().execute(...args),
  runStep: (...args) => getDefaultApplication().runStep(...args),
  runPipeline: (...args) => getDefaultApplication().runPipeline(...args)
};
