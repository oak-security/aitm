"use strict";

const prompts = require("./prompts");
const schemas = require("./schemas");
const { appError } = require("../util");

function createOrchestrate({ getAdapter, keyStore, settings, emitEvent = () => {} }) {
  if (typeof getAdapter !== "function") throw new TypeError("createOrchestrate requires getAdapter.");
  if (!keyStore || !settings) throw new TypeError("createOrchestrate requires keyStore and settings adapters.");

// No wall-clock timeout: calls stream, so long generations don't stall. Cancellation is
// explicit (the renderer's Cancel button -> cancelAll). Tracks in-flight controllers,
// each tagged with a caller-defined scope. All current frontends are single-user and
// leave the default null scope, so cancelAll() aborts everything; setScopeProvider is
// retained for a host that ever needs to partition cancellation.
  const activeControllers = new Map(); // controller -> scope
  let scopeProvider = () => null;

function setScopeProvider(fn) {
  scopeProvider = typeof fn === "function" ? fn : () => null;
}

function cancelAll(scope) {
  let cancelled = 0;
  for (const [c, s] of activeControllers) {
    if (scope !== undefined && s !== scope) continue;
    c.abort(appError("cancelled", "Request cancelled."));
    cancelled += 1;
  }
  return { cancelled };
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

// "fast" vs "deep" is about reasoning depth, not input size: the fast model handles the
// steps that read the *most* context (traceModel gets every source digest, report gets
// the whole reviewed model), while deep is reserved for the steps that reason hardest
// over an already-condensed model (STRIDE, coordination). So a fast model chosen purely
// on price can be the wrong trade if it is weak at long context. Prefer a mid tier there
// on large source sets.
async function call({ model, name, label, schema, system, user, effort }) {
  const cfg = settings.get();
  const adapter = getAdapter(cfg.provider);
  const key = keyStore.readKey(cfg.provider);
  const resolvedModel = model === "deep" ? cfg.modelDeep : cfg.modelFast;

  const controller = new AbortController();
  activeControllers.set(controller, scopeProvider());
  const stage = label || name;
  emitEvent({ event: "start", label: stage, model: resolvedModel });

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
        if (n % 6 === 0) emitEvent({ event: "progress", label: stage, tokens: tokens() });
      }
    });
    emitEvent({ event: "end", label: stage, tokens: tokens() });
    return result;
  } catch (err) {
    emitEvent({ event: "error", message: (err && err.message) || "Failed." });
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

// Build a tree for a single threat (one tree per threat so trees map to threats).
function attackTree(project, threatId) {
  const threat = (project.strideThreats || []).find((t) => t.id === threatId) || null;
  return call({
    model: "fast",
    name: "attack_tree",
    label: "Attack tree",
    effort: "low",
    schema: schemas.attackTreeSchema(),
    system: prompts.ATTACK_TREE,
    user: {
      threat,
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

// Reduce an ingestion candidate set to a scope hint (e.g. "only the docs directory").
// Returns { include: [relative paths], note } — an empty include means no reduction.
function scopeFilter({ hint, dirs, files }) {
  return call({
    model: "fast",
    name: "scope_filter",
    label: "Scope filter",
    effort: "low",
    schema: schemas.scopeFilterSchema(),
    system: prompts.SCOPE_FILTER,
    user: { hint, directories: dirs, files }
  });
}

function report(project, enabledPhases) {
  return call({
    // The report synthesizes already-reviewed data, so it uses the fast model
    // (e.g. Sonnet 5 / GPT-5.6 Luna) — far quicker than the deep model for assembly.
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

  return Object.freeze({
    classify,
    traceModel,
    stride,
    attackTree,
    coordination,
    scopeFilter,
    report,
    cancelAll,
    setScopeProvider
  });
}

module.exports = { createOrchestrate };
