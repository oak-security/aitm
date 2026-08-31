"use strict";

const { uuid, appError } = require("../util");

const SCHEMA_VERSION = 2;

function nowIso() {
  return new Date().toISOString();
}

function emptyTraceModel() {
  return {
    protectedAssets: [],
    threatActors: [],
    roles: [],
    invariants: [],
    components: [],
    trustBoundaries: [],
    valueFlows: [],
    openQuestions: []
  };
}

function createProject(name) {
  const ts = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    project: {
      id: uuid(),
      name: (name && String(name).trim()) || "Untitled threat model",
      createdAt: ts,
      updatedAt: ts,
      status: "draft",
      notes: ""
    },
    scope: { boundaries: "", inScope: "", outOfScope: "", assumptions: "" },
    // Required phases are always present; optional ones seeded after classification.
    phasesEnabled: ["scope", "ingest", "trace-model", "stride", "attack-trees", "report"],
    classification: { profile: "Unclassified", confidence: "low", rationale: "", evidence: [], coordinationRelevant: false, warnings: [], userOverride: false },
    sources: [],
    traceModel: emptyTraceModel(),
    strideThreats: [],
    attackTrees: [],
    coordination: { enabled: false, scenarios: [], notes: "" },
    report: { markdown: "", html: "", generatedAt: "" },
    approvals: {}
  };
}

// Accepts source-app schema (v1) and partial/foreign objects; fills gaps, never throws
// on missing fields. Used for both load and import.
function normalize(input) {
  if (!input || typeof input !== "object") throw appError("bad_project", "Project data is not an object.");
  const base = createProject(input.project?.name || input.name);
  const p = { ...base, ...input };

  p.schemaVersion = SCHEMA_VERSION;
  p.project = { ...base.project, ...(input.project || {}) };
  if (!p.project.id) p.project.id = base.project.id;
  p.scope = { ...base.scope, ...(input.scope || {}) };
  p.classification = { ...base.classification, ...(input.classification || {}) };
  p.traceModel = { ...emptyTraceModel(), ...(input.traceModel || input.systemModel || {}) };
  // map legacy privilegedRoles -> roles
  if (input.systemModel?.privilegedRoles && !p.traceModel.roles.length) {
    p.traceModel.roles = input.systemModel.privilegedRoles;
  }
  p.sources = Array.isArray(input.sources) ? input.sources : [];
  p.strideThreats = Array.isArray(input.strideThreats) ? input.strideThreats : [];
  p.attackTrees = Array.isArray(input.attackTrees) ? input.attackTrees : [];
  p.coordination = { ...base.coordination, ...(input.coordination || input.abcCollusion || {}) };
  p.report = { ...base.report, ...(input.report || {}) };
  p.approvals = (input.approvals && typeof input.approvals === "object") ? input.approvals : {};
  p.phasesEnabled = Array.isArray(input.phasesEnabled) && input.phasesEnabled.length
    ? input.phasesEnabled
    : base.phasesEnabled;

  return p;
}

module.exports = { SCHEMA_VERSION, createProject, normalize, nowIso, emptyTraceModel };
