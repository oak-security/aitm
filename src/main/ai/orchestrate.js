"use strict";

const { getAdapter } = require("./index");
const prompts = require("./prompts");
const schemas = require("./schemas");
const keystore = require("../keystore");
const settings = require("../settings");

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

function call({ model, name, schema, system, user }) {
  const cfg = settings.get();
  const adapter = getAdapter(cfg.provider);
  const key = keystore.readKey();
  const resolvedModel = model === "deep" ? cfg.modelDeep : cfg.modelFast;
  return adapter.structuredCall({
    model: resolvedModel,
    name,
    schema,
    system,
    user: JSON.stringify(user, null, 2),
    key
  });
}

function classify(project) {
  return call({
    model: "fast",
    name: "classification",
    schema: schemas.classificationSchema(),
    system: prompts.CLASSIFY,
    user: { scope: project.scope, notes: project.project.notes, sources: sourcesContext(project) }
  });
}

function traceModel(project) {
  return call({
    model: "fast",
    name: "trace_model",
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
    model: "deep",
    name: "threat_model_report",
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

module.exports = { classify, traceModel, stride, attackTree, coordination, report };
