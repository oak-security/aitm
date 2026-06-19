"use strict";

const { getAdapter } = require("./index");
const prompts = require("./prompts");
const schemas = require("./schemas");
const keystore = require("../keystore");
const settings = require("../settings");
const { appError } = require("../util");
const { emitStream } = require("../stream");

// No wall-clock timeout: calls stream, so long generations don't stall. Cancellation is
// explicit (the renderer's Cancel button -> cancelAll). Tracks in-flight controllers.
const activeControllers = new Set();

function cancelAll() {
  for (const c of activeControllers) c.abort(appError("cancelled", "Request cancelled."));
  return { cancelled: activeControllers.size };
}

// Build a compact source context: summaries plus a bounded set of excerpts / sample
// files, mirroring the caps from the source app to keep prompts within budget.
function sourcesContext(project) {
  return (project.sources || []).map((s) => ({
    type: s.type,
    label: s.label,
    summary: s.summary || "",
    files: Array.isArray(s.files) ? s.files.slice(0, 200) : undefined,
    sampleFiles: Array.isArray(s.sampleFiles) ? s.sampleFiles.slice(0, 18) : undefined,
    excerpt: s.excerpt ? String(s.excerpt).slice(0, 12000) : undefined
  }));
}

async function call({ model, name, label, schema, system, user, effort }) {
  const cfg = settings.get();
  const adapter = getAdapter(cfg.provider);
  const key = keystore.readKey(cfg.provider);
  const resolvedModel = model === "deep" ? cfg.modelDeep : cfg.modelFast;

  const controller = new AbortController();
  activeControllers.add(controller);
  const stage = label || name;
  emitStream({ event: "start", label: stage, model: resolvedModel });

  // Live, approximate token count from streamed deltas (~4 chars/token), throttled.
  let chars = 0;
  let n = 0;
  const tokens = () => Math.round(chars / 4);
  try {
    const result = await adapter.structuredCall({
      model: resolvedModel,
      name,
      schema,
      system,
      user: JSON.stringify(user, null, 2),
      key,
      effort,
      signal: controller.signal,
      onDelta: (text) => {
        chars += text.length;
        n += 1;
        if (n % 6 === 0) emitStream({ event: "progress", label: stage, tokens: tokens() });
      }
    });
    emitStream({ event: "end", label: stage, tokens: tokens() });
    return result;
  } catch (err) {
    emitStream({ event: "error", message: (err && err.message) || "Failed." });
    throw err;
  } finally {
    activeControllers.delete(controller);
  }
}

function classify(project) {
  return call({
    model: "fast",
    name: "classification",
    label: "Classify",
    effort: "low",
    schema: schemas.classificationSchema(),
    system: prompts.CLASSIFY,
    user: { scope: project.scope, notes: project.project.notes, sources: sourcesContext(project) }
  });
}

function traceModel(project) {
  return call({
    model: "fast",
    name: "trace_model",
    label: "TRACE model",
    effort: "low",
    schema: schemas.traceModelSchema(),
    system: prompts.TRACE_MODEL,
    user: {
      profile: project.classification.profile,
      classification: project.classification,
      scope: project.scope,
      notes: project.project.notes,
      sources: sourcesContext(project)
    }
  });
}

function stride(project) {
  return call({
    model: "deep",
    name: "stride_threats",
    label: "STRIDE",
    effort: "medium",
    schema: schemas.strideSchema(),
    system: prompts.STRIDE,
    user: { profile: project.classification.profile, traceModel: project.traceModel }
  });
}

function attackTree(project, selection) {
  const ids = new Set((selection && selection.threatIds) || []);
  const selectedThreats = (project.strideThreats || []).filter((t) => ids.has(t.id));
  return call({
    model: "fast",
    name: "attack_tree",
    label: "Attack tree",
    effort: "low",
    schema: schemas.attackTreeSchema(),
    system: prompts.ATTACK_TREE,
    user: {
      selectedThreats: selectedThreats.length ? selectedThreats : project.strideThreats,
      components: project.traceModel.components,
      protectedAssets: project.traceModel.protectedAssets
    }
  });
}

function coordination(project) {
  return call({
    model: "deep",
    name: "coordination_analysis",
    label: "Coordination",
    effort: "medium",
    schema: schemas.coordinationSchema(),
    system: prompts.COORDINATION,
    user: {
      profile: project.classification.profile,
      threatActors: project.traceModel.threatActors,
      roles: project.traceModel.roles,
      protectedAssets: project.traceModel.protectedAssets,
      invariants: project.traceModel.invariants
    }
  });
}

function report(project, enabledPhases) {
  return call({
    // The report synthesizes already-reviewed data, so it uses the fast model
    // (e.g. Sonnet / gpt-5-mini) — far quicker than the deep model for assembly.
    model: "fast",
    name: "threat_model_report",
    label: "Report",
    effort: "low",
    schema: schemas.reportSchema(),
    system: prompts.REPORT,
    user: {
      enabledPhases,
      name: project.project.name,
      profile: project.classification.profile,
      scope: project.scope,
      classification: project.classification,
      traceModel: project.traceModel,
      strideThreats: project.strideThreats,
      attackTrees: enabledPhases.includes("attack-trees") ? project.attackTrees : [],
      coordination: enabledPhases.includes("coordination") ? project.coordination : { enabled: false, scenarios: [], notes: "" }
    }
  });
}

module.exports = { classify, traceModel, stride, attackTree, coordination, report, cancelAll };
