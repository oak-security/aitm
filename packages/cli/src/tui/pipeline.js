// TUI adapter for the shared application pipeline. The application module owns every
// mutation; this file adds only the TUI's step descriptors and human summaries.
import * as core from "./core.js";

const { application, phases } = core;

export const RISK_RANK = application.RISK_RANK;

export function topThreats(threats, n) {
  return application.topThreats(threats, n);
}

export async function runClassify(project) {
  return (await application.runStep(project.project.id, "classify")).project;
}

export async function runTraceModel(project) {
  return (await application.runStep(project.project.id, "trace-model")).project;
}

export async function runStride(project) {
  return (await application.runStep(project.project.id, "stride")).project;
}

export async function runAttackTrees(project, threatIds) {
  return (await application.runStep(project.project.id, "attack-trees", { threatIds })).project;
}

export async function runCoordination(project) {
  return (await application.runStep(project.project.id, "coordination")).project;
}

export async function runReport(project) {
  return (await application.runStep(project.project.id, "report")).project;
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
