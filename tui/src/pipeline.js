// Phase runners mirroring the desktop app's IPC ai.* handlers (src/main/ipc/index.js):
// each runs one orchestrate step, merges the draft into the project, and persists.
import * as core from "./core.js";

const { orchestrate, store, phases, render, util } = core;

export const RISK_RANK = { Critical: 5, High: 4, Medium: 3, Low: 2, Informational: 1, "N/A": 0 };

export function topThreats(threats, n) {
  return (threats || [])
    .filter((t) => t.isApplicable !== false)
    .slice()
    .sort((a, b) => (RISK_RANK[b.risk] || 0) - (RISK_RANK[a.risk] || 0))
    .slice(0, n);
}

export async function runClassify(project) {
  const draft = await orchestrate.classify(project);
  project.classification = { ...draft, userOverride: false };
  project.phasesEnabled = phases.seedEnabled(project.classification, project.phasesEnabled);
  project.coordination.enabled = project.phasesEnabled.includes("coordination");
  return store.persist(project);
}

export async function runTraceModel(project) {
  const draft = await orchestrate.traceModel(project);
  project.traceModel = { ...project.traceModel, ...draft };
  return store.persist(project);
}

export async function runStride(project) {
  const draft = await orchestrate.stride(project);
  project.strideThreats = (draft.threats || []).map((t) => ({ id: util.uuid(), status: "draft", ...t }));
  return store.persist(project);
}

// Accumulative, one tree per threat; persists after each tree so a cancel keeps progress.
export async function runAttackTrees(project, threatIds) {
  const existing = new Set((project.attackTrees || []).map((t) => t.threatId).filter(Boolean));
  const ids = (threatIds || []).filter((id) => id && !existing.has(id));
  for (const threatId of ids) {
    const draft = await orchestrate.attackTree(project, threatId);
    project.attackTrees.push({ id: util.uuid(), threatId, ...draft });
    project = store.persist(project);
  }
  return project;
}

export async function runCoordination(project) {
  const draft = await orchestrate.coordination(project);
  project.coordination = { enabled: true, scenarios: draft.scenarios || [], notes: draft.notes || "" };
  return store.persist(project);
}

export async function runReport(project) {
  const enabled = Array.isArray(project.phasesEnabled) ? project.phasesEnabled : [];
  const draft = await orchestrate.report(project, enabled);
  project.report = {
    markdown: draft.markdown || "",
    html: render.toHtml(draft.markdown || "", project.project.name),
    generatedAt: new Date().toISOString()
  };
  return store.persist(project);
}

// The step sequence for both workflow modes. Optional steps mark themselves skipped
// when the phase is disabled (classification decides coordination relevance).
export const STEPS = [
  { id: "classify", title: "Classify", run: (p) => runClassify(p) },
  { id: "trace-model", title: "TRACE model", run: (p) => runTraceModel(p) },
  { id: "stride", title: "STRIDE", run: (p) => runStride(p) },
  {
    id: "attack-trees",
    title: "Attack trees",
    optional: true,
    enabled: (p) => phases.isEnabled(p, "attack-trees") && (p.strideThreats || []).length > 0,
    run: (p, opts) => runAttackTrees(p, (opts && opts.threatIds) || topThreats(p.strideThreats, 3).map((t) => t.id))
  },
  {
    id: "coordination",
    title: "Coordination",
    optional: true,
    enabled: (p) => phases.isEnabled(p, "coordination"),
    run: (p) => runCoordination(p)
  },
  { id: "report", title: "Report", run: (p) => runReport(p) }
];

export function summarize(stepId, project) {
  if (stepId === "classify") {
    const c = project.classification;
    return [
      `Profile: ${c.profile} (confidence ${c.confidence})`,
      `Coordination relevant: ${c.coordinationRelevant ? "yes" : "no"}`,
      ...(c.rationale ? [c.rationale] : []),
      ...(c.warnings || []).map((w) => `Warning: ${w}`)
    ];
  }
  if (stepId === "trace-model") {
    const m = project.traceModel;
    return [
      `Protected assets: ${m.protectedAssets.length}  Threat actors: ${m.threatActors.length}  Roles: ${m.roles.length}`,
      `Invariants: ${m.invariants.length}  Components: ${m.components.length}  Trust boundaries: ${m.trustBoundaries.length}`,
      `Value/data flows: ${m.valueFlows.length}  Open questions: ${m.openQuestions.length}`
    ];
  }
  if (stepId === "stride") {
    const counts = {};
    for (const t of project.strideThreats) {
      if (t.isApplicable === false) continue;
      counts[t.risk] = (counts[t.risk] || 0) + 1;
    }
    const order = ["Critical", "High", "Medium", "Low", "Informational", "N/A"];
    const parts = order.filter((r) => counts[r]).map((r) => `${r}: ${counts[r]}`);
    return [`${project.strideThreats.length} threats drafted`, parts.join("  ") || "none applicable"];
  }
  if (stepId === "attack-trees") {
    return [`${(project.attackTrees || []).length} attack tree(s) built`];
  }
  if (stepId === "coordination") {
    return [`${(project.coordination.scenarios || []).length} coordination scenario(s)`];
  }
  if (stepId === "report") {
    return [`Report generated (${(project.report.markdown || "").length} chars of Markdown)`];
  }
  return [];
}
