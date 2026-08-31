"use strict";

// TRACE phase registry. Required phases (0,1,2,3,6) cannot be disabled. Optional
// phases (attack-trees, coordination, and any added here) are user-toggleable; their
// default enablement is seeded from appliesWhen() against the project classification.
// The workflow nav, auto-run, and report all derive from a project's enabled-phase set.

const PHASES = [
  {
    id: "scope",
    trace: 0,
    title: "Scope & Source Inventory",
    required: true,
    appliesWhen: () => true
  },
  {
    id: "ingest",
    trace: 1,
    title: "Ingest Sources",
    required: true,
    appliesWhen: () => true
  },
  {
    id: "trace-model",
    trace: 2,
    title: "Construct TRACE Model",
    required: true,
    appliesWhen: () => true
  },
  {
    id: "stride",
    trace: 3,
    title: "STRIDE Identification & Ranking",
    required: true,
    appliesWhen: () => true
  },
  {
    id: "attack-trees",
    trace: 4,
    title: "Build Attack Trees",
    required: false,
    appliesWhen: () => true // important threats generally exist; default on, user can disable
  },
  {
    id: "coordination",
    trace: 5,
    title: "Collusion & Coordination Inspection",
    required: false,
    // Default on only when actor groups can coordinate (validators, multisigs,
    // committees, DAOs, signer sets) — flagged by classification.
    appliesWhen: (classification) => Boolean(classification && classification.coordinationRelevant)
  },
  {
    id: "report",
    trace: 6,
    title: "Roadmap & Report",
    required: true,
    appliesWhen: () => true
  }
];

const PHASE_IDS = PHASES.map((p) => p.id);
const REQUIRED_IDS = PHASES.filter((p) => p.required).map((p) => p.id);

function registry(classification) {
  return PHASES.map((p) => ({
    id: p.id,
    trace: p.trace,
    title: p.title,
    required: p.required,
    defaultEnabled: p.required || p.appliesWhen(classification)
  }));
}

// Seed a project's enabled-phase set from classification. An optional phase is enabled
// if it was already on, or if it newly applies to this classification (so classifying a
// coordination-relevant system turns the coordination phase on). Required phases always
// stay on. The user can still disable any optional phase afterward in the Phases view.
function seedEnabled(classification, previousEnabled) {
  const prev = new Set(Array.isArray(previousEnabled) ? previousEnabled : []);
  return registry(classification)
    .filter((p) => p.required || prev.has(p.id) || p.defaultEnabled)
    .map((p) => p.id);
}

function isEnabled(project, id) {
  return Array.isArray(project.phasesEnabled) && project.phasesEnabled.includes(id);
}

module.exports = { PHASES, PHASE_IDS, REQUIRED_IDS, registry, seedEnabled, isEnabled };
