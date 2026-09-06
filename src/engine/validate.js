import { insist, parse } from './errors.js';
import { Schemas } from './schema.js';

export const modelItems = (model) =>
  model
    ? ['threatActors', 'roles', 'protectedAssets', 'invariants', 'components', 'edges'].flatMap(
        (key) => model[key],
      )
    : [];
export const rankedThreats = (project) =>
  [...(project.artifacts.stride?.data.threats || [])].sort(
    (a, b) => b.likelihood * b.impact - a.likelihood * a.impact || a.id.localeCompare(b.id),
  );
const setOf = (items) => new Set(items.map((x) => x.id));
function unique(items, label) {
  insist(setOf(items).size === items.length, `Duplicate ${label} IDs.`);
}
function links(values, allowed, label) {
  for (const value of values) insist(allowed.has(value), `Unknown ${label} reference: ${value}.`);
}

// Providers can copy a real quote while miscounting numbered lines. Resolve only
// a unique, byte-for-byte quote in its claimed file; never fuzzy-match or invent evidence.
export function resolveEvidence(phase, raw, project) {
  const data = parse(Schemas[phase], raw);
  const files = new Map(project.sources.flatMap((s) => s.files.map((f) => [f.id, f])));
  const corrections = [];
  function visit(value, location = phase) {
    if (!value || typeof value !== 'object') return;
    if ('evidence' in value && 'assumption' in value)
      for (const [index, ref] of value.evidence.entries()) {
        const file = files.get(ref.fileId);
        if (!file || !ref.quote.trim()) continue;
        const cited = file.text
          .split('\n')
          .slice(ref.startLine - 1, ref.endLine)
          .join('\n');
        if (ref.endLine >= ref.startLine && ref.endLine <= file.lines && cited.includes(ref.quote))
          continue;
        const start = file.text.indexOf(ref.quote);
        if (start < 0 || file.text.indexOf(ref.quote, start + 1) >= 0) continue;
        const startLine = file.text.slice(0, start).split('\n').length;
        const endLine = startLine + ref.quote.split('\n').length - 1;
        corrections.push({
          path: `${location}.evidence[${index}]`,
          fileId: ref.fileId,
          from: [ref.startLine, ref.endLine],
          to: [startLine, endLine],
        });
        ref.startLine = startLine;
        ref.endLine = endLine;
      }
    for (const [key, child] of Object.entries(value))
      if (typeof child === 'object') visit(child, `${location}.${key}`);
  }
  visit(data);
  return { data, corrections };
}

// Coverage is an index of threat references, not a second independent source of
// truth. Keep uncovered rationales, but explicitly flag any newly exposed gap.
export function resolveCoverage(data, project) {
  const model = project.artifacts.model.data;
  const required = [...model.protectedAssets, ...model.invariants, ...model.edges];
  const rows = [...data.coverage];
  for (const object of required)
    if (!rows.some((row) => row.objectId === object.id))
      rows.push({ objectId: object.id, threatIds: [], explanation: '' });
  const corrections = [];
  for (const row of rows) {
    const linked = data.threats
      .filter((threat) =>
        [
          ...threat.targetIds,
          ...threat.actorIds,
          ...threat.assetIds,
          ...threat.invariantIds,
        ].includes(row.objectId),
      )
      .map((threat) => threat.id);
    const same =
      JSON.stringify([...new Set(row.threatIds)].sort()) === JSON.stringify([...linked].sort());
    if (same && (linked.length || row.explanation.trim())) continue;
    corrections.push({ objectId: row.objectId, from: row.threatIds, to: linked });
    row.threatIds = linked;
    row.explanation = linked.length
      ? 'Coverage computed from the threats that explicitly reference this object.'
      : 'No generated threat references this object. Expert review of this coverage gap is required.';
    if (!linked.length && data.openQuestions.length < 200)
      data.openQuestions.push(
        `Review coverage gap for ${row.objectId}: no generated threat references this object.`,
      );
  }
  data.coverage = rows;
  return corrections;
}

export function validateArtifact(phase, raw, project) {
  const data = parse(Schemas[phase], raw);
  const files = new Map(project.sources.flatMap((s) => s.files.map((f) => [f.id, f])));
  const evidenceErrors = [];
  function ground(value, location = phase) {
    if (!value || typeof value !== 'object') return;
    if ('evidence' in value && 'assumption' in value) {
      if (!value.evidence.length && !value.assumption.trim())
        evidenceErrors.push(`${location}: needs evidence or an explicit inferred assumption.`);
      for (const [index, ref] of value.evidence.entries()) {
        const at = `${location}.evidence[${index}]`;
        const file = files.get(ref.fileId);
        if (!file) {
          evidenceErrors.push(`${at}: Unknown evidence file: ${ref.fileId}.`);
          continue;
        }
        if (ref.endLine < ref.startLine || ref.endLine > file.lines) {
          evidenceErrors.push(
            `${at}: Evidence line range is outside its source (${file.lines} lines).`,
          );
          continue;
        }
        const excerpt = file.text
          .split('\n')
          .slice(ref.startLine - 1, ref.endLine)
          .join('\n');
        if (!ref.quote.trim() || !excerpt.includes(ref.quote))
          evidenceErrors.push(
            `${at}: Evidence quote does not match ${ref.fileId}:${ref.startLine}-${ref.endLine}. Cited text begins ${JSON.stringify(excerpt.slice(0, 300))}. Copy a short exact substring, preserve whitespace, or correct the line numbers.`,
          );
      }
    }
    for (const [key, child] of Object.entries(value))
      if (typeof child === 'object') ground(child, `${location}.${key}`);
  }
  ground(data);
  insist(
    !evidenceErrors.length,
    `${evidenceErrors.length} evidence error(s): ${evidenceErrors.slice(0, 12).join('\n')}`,
  );
  const model = phase === 'model' ? data : project.artifacts.model?.data;
  const objects = modelItems(model),
    modelIds = setOf(objects);
  const threatData = project.artifacts.stride?.data.threats || [];
  const threatIds = setOf(threatData);
  if (phase === 'ingest') unique(data.candidates, 'candidate');
  if (phase === 'model') {
    unique(objects, 'model object');
    const endpoints = setOf([
      ...model.components,
      ...model.roles,
      ...model.threatActors,
      ...model.protectedAssets,
    ]);
    for (const edge of model.edges) links([edge.from, edge.to], endpoints, 'edge endpoint');
  }
  if (phase === 'stride') {
    unique(data.threats, 'threat');
    const targets = setOf([...model.components, ...model.roles, ...model.edges]);
    for (const threat of data.threats) {
      insist(!modelIds.has(threat.id), 'Threat IDs must differ from model IDs.');
      links(threat.targetIds, targets, 'target');
      links(threat.actorIds, setOf(model.threatActors), 'actor');
      links(threat.assetIds, setOf(model.protectedAssets), 'asset');
      links(threat.invariantIds, setOf(model.invariants), 'invariant');
      insist(
        threat.assetIds.length + threat.invariantIds.length > 0 ||
          threat.targetIds.some(
            (id) => model.roles.some((x) => x.id === id) || model.edges.some((x) => x.id === id),
          ),
        'A material threat must map to an asset, invariant, role or edge.',
      );
    }
    const covered = new Set();
    for (const row of data.coverage) {
      insist(!covered.has(row.objectId), 'Duplicate coverage row.');
      covered.add(row.objectId);
      links([row.objectId], modelIds, 'coverage object');
      links(row.threatIds, setOf(data.threats), 'coverage threat');
      insist(row.threatIds.length || row.explanation.trim(), 'Uncovered objects need a reason.');
      for (const threatId of row.threatIds) {
        const threat = data.threats.find((t) => t.id === threatId);
        insist(
          [
            ...threat.targetIds,
            ...threat.assetIds,
            ...threat.invariantIds,
            ...threat.actorIds,
          ].includes(row.objectId),
          'Coverage must match the threat references.',
        );
      }
    }
    for (const item of [...model.protectedAssets, ...model.invariants, ...model.edges])
      insist(covered.has(item.id), `Missing coverage for ${item.id}.`);
  }
  if (phase === 'trees') {
    const addressed = new Set(),
      nodeIds = new Set();
    for (const tree of data.trees) {
      links([tree.threatId], threatIds, 'tree threat');
      insist(!addressed.has(tree.threatId), 'Duplicate attack tree.');
      addressed.add(tree.threatId);
      unique(tree.nodes, 'tree node');
      const nodes = new Map(tree.nodes.map((n) => [n.id, n]));
      insist(
        tree.nodes.filter((n) => n.parentId === null).length === 1,
        'Each attack tree needs exactly one root.',
      );
      for (const node of tree.nodes) {
        insist(
          !nodeIds.has(node.id) && !modelIds.has(node.id) && !threatIds.has(node.id),
          'Tree node IDs must be globally unique.',
        );
        nodeIds.add(node.id);
        const visited = new Set([node.id]);
        let current = node;
        while (current.parentId !== null) {
          insist(
            nodes.has(current.parentId) && !visited.has(current.parentId),
            'Attack tree has a missing parent or cycle.',
          );
          visited.add(current.parentId);
          current = nodes.get(current.parentId);
        }
        const children = tree.nodes.filter((n) => n.parentId === node.id);
        insist(
          node.operator === 'LEAF' ? children.length === 0 : children.length > 0,
          'Tree operators must match the branch structure.',
        );
        if (node.operator === 'LEAF')
          insist(node.mitigations.length > 0, 'Attack-tree leaves need mitigations.');
      }
    }
    for (const omitted of data.omitted) {
      links([omitted.threatId], threatIds, 'omitted threat');
      insist(!addressed.has(omitted.threatId), 'Threat cannot have both a tree and an omission.');
      addressed.add(omitted.threatId);
    }
    for (const threat of rankedThreats(project).slice(0, project.config.treeLimit))
      insist(
        addressed.has(threat.id),
        `Top threat ${threat.id} needs a tree or a documented omission.`,
      );
  }
  if (phase === 'coordination') {
    unique(data.scenarios, 'coordination scenario');
    for (const scenario of data.scenarios) {
      insist(
        !modelIds.has(scenario.id) && !threatIds.has(scenario.id),
        'Coordination IDs must differ from model and threat IDs.',
      );
      links(
        scenario.actorIds,
        setOf([...model.threatActors, ...model.roles]),
        'coordination actor',
      );
      links(scenario.assetIds, setOf(model.protectedAssets), 'coordination asset');
    }
  }
  if (phase === 'report') {
    const allowed = new Set([
      ...modelIds,
      ...threatIds,
      ...(project.artifacts.trees?.data.trees || []).flatMap((t) => t.nodes.map((n) => n.id)),
      ...(project.artifacts.coordination?.data.scenarios || []).map((s) => s.id),
    ]);
    unique(data.roadmap, 'recommendation');
    for (const row of data.roadmap) links(row.linkedIds, allowed, 'roadmap');
    insist(
      !threatData.length || data.roadmap.length > 0,
      'A model with threats needs a mitigation roadmap.',
    );
  }
  return data;
}
