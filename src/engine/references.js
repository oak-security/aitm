import { modelItems } from './validate.js';

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// Repair only an unambiguous identity/name match. Never guess a semantic mapping
// or create a model object to make a generated reference pass validation.
export function resolveReferences(phase, data, project) {
  const model = phase === 'model' ? data : project.artifacts.model?.data;
  if (!model) return { corrections: [], warnings: [] };
  const objects = modelItems(model);
  const known = [...objects, ...(project.artifacts.ingest?.data.candidates || [])];
  const corrections = [],
    warnings = [];
  function resolve(value, allowed, path) {
    if (allowed.some((item) => item.id === value)) return value;
    const old = known.find((item) => item.id === value);
    const matches = allowed.filter(
      (item) =>
        normalize(item.id) === normalize(value) ||
        (old && normalize(item.name) === normalize(old.name)),
    );
    if (matches.length !== 1) return null;
    corrections.push({ path, from: value, to: matches[0].id });
    return matches[0].id;
  }
  function note(owner, path, rejected) {
    const message = `Reference review required: ${path} contains unresolved IDs (${rejected.join(', ')}). These links were not included; review the claim's model mapping.`;
    warnings.push({
      path,
      claim: owner.title || owner.name || owner.id || path,
      rejectedIds: rejected,
      note: message,
    });
    if (typeof owner.assumption === 'string') {
      owner.assumption = `${message}\n${owner.assumption}`.trim().slice(0, 12000);
      if ('confidence' in owner) owner.confidence = 'low';
    } else if (data.openQuestions?.length < 200) data.openQuestions.push(message);
  }
  function links(owner, field, allowed, path, minimum = 0) {
    const rejected = [],
      values = [];
    for (const value of owner[field]) {
      const mapped = resolve(value, allowed, `${path}.${field}`);
      if (mapped) values.push(mapped);
      else rejected.push(value);
    }
    // A required relationship with no identifiable endpoint needs the bounded
    // structural repair. Preserve the invalid value for the validator to explain.
    if (values.length < minimum) return;
    owner[field] = [...new Set(values)];
    if (rejected.length) note(owner, `${path}.${field}`, rejected);
  }
  if (phase === 'model') {
    const endpoints = [
      ...model.components,
      ...model.roles,
      ...model.threatActors,
      ...model.protectedAssets,
    ];
    for (const edge of model.edges)
      for (const key of ['from', 'to'])
        edge[key] = resolve(edge[key], endpoints, `model.${edge.id}.${key}`) || edge[key];
  }
  if (phase === 'stride') {
    for (const threat of data.threats) {
      const path = `stride.${threat.id}`;
      links(threat, 'targetIds', [...model.components, ...model.roles, ...model.edges], path, 1);
      links(threat, 'actorIds', model.threatActors, path);
      links(threat, 'assetIds', model.protectedAssets, path);
      links(threat, 'invariantIds', model.invariants, path);
    }
    const rows = new Map();
    for (const row of data.coverage) {
      const mapped = resolve(row.objectId, objects, 'stride.coverage.objectId');
      if (!mapped) {
        note(row, 'stride.coverage.objectId', [row.objectId]);
        continue;
      }
      if (!rows.has(mapped)) rows.set(mapped, { ...row, objectId: mapped });
    }
    data.coverage = [...rows.values()];
  }
  if (phase === 'coordination')
    for (const scenario of data.scenarios) {
      links(
        scenario,
        'actorIds',
        [...model.threatActors, ...model.roles],
        `coordination.${scenario.id}`,
        1,
      );
      links(scenario, 'assetIds', model.protectedAssets, `coordination.${scenario.id}`, 1);
    }
  if (phase === 'report')
    for (const row of data.roadmap)
      links(
        row,
        'linkedIds',
        [
          ...objects,
          ...(project.artifacts.stride?.data.threats || []),
          ...(project.artifacts.trees?.data.trees || []).flatMap((tree) => tree.nodes),
          ...(project.artifacts.coordination?.data.scenarios || []),
        ],
        `report.${row.id}`,
        1,
      );
  return { corrections, warnings };
}
