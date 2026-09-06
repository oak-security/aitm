import { z } from 'zod';
import { Schemas, enabledPhases } from './schema.js';
import { sourceBatches } from './ingest.js';
import { modelItems, rankedThreats } from './validate.js';

export function generationSources(phase, project) {
  if (phase === 'model') return sourceBatches(project);
  return [
    project.sources.flatMap((source) =>
      source.files.map((file) => ({
        id: file.id,
        path: file.path,
        source: source.label,
        sourceId: source.id,
        hash: file.hash,
        lines: file.lines,
        characters: file.text.length,
      })),
    ),
  ];
}

// Each phase consumes its immediate domain inputs, rather than every historical
// representation of the same objects. Classification IDs are not model IDs.
export function generationArtifacts(phase, project) {
  const inputs =
    {
      ingest: [],
      model: ['ingest'],
      stride: ['model'],
      trees: ['model', 'stride'],
      coordination: ['model', 'stride'],
      report: ['model', 'stride', 'trees', 'coordination'],
    }[phase] || [];
  const enabled = new Set(enabledPhases(project).map((p) => p.id));
  return Object.fromEntries(
    inputs
      .filter((id) => enabled.has(id) && project.artifacts[id])
      .map((id) => [id, project.artifacts[id].data]),
  );
}

// Constrain cross-phase links at generation time, as well as validating them
// afterwards. A provider cannot substitute an old candidate ID for a model ID.
export function generationSchema(phase, project) {
  const schema = Schemas[phase];
  const model = project.artifacts.model?.data;
  const refs = (items, minimum = 0) => {
    const values = [...new Set(items.map((item) => item.id))];
    return values.length
      ? z.array(z.enum(values)).min(minimum).max(200)
      : z.array(z.string()).max(0);
  };
  if (phase === 'ingest') return schema.extend({ candidates: schema.shape.candidates.max(0) });
  if (phase === 'model')
    return schema.extend({
      protectedAssets: z.array(schema.shape.protectedAssets.element).max(100),
      invariants: z.array(schema.shape.invariants.element).max(100),
      components: z.array(schema.shape.components.element).max(100),
    });
  if (phase === 'stride' && model)
    return schema.extend({
      threats: z
        .array(
          schema.shape.threats.element.extend({
            targetIds: refs([...model.components, ...model.roles, ...model.edges], 1),
            actorIds: refs(model.threatActors),
            assetIds: refs(model.protectedAssets),
            invariantIds: refs(model.invariants),
          }),
        )
        .max(120),
      coverage: schema.shape.coverage.max(0),
    });
  if (phase === 'trees') {
    const threatIds = rankedThreats(project)
      .slice(0, project.config.treeLimit)
      .map((t) => t.id);
    if (!threatIds.length)
      return schema.extend({
        trees: schema.shape.trees.max(0),
        omitted: schema.shape.omitted.max(0),
      });
    return schema.extend({
      trees: z.array(schema.shape.trees.element.extend({ threatId: z.enum(threatIds) })).max(10),
      omitted: z
        .array(schema.shape.omitted.element.extend({ threatId: z.enum(threatIds) }))
        .max(120),
    });
  }
  if (phase === 'coordination' && model)
    return schema.extend({
      scenarios: z
        .array(
          schema.shape.scenarios.element.extend({
            actorIds: refs([...model.threatActors, ...model.roles], 1),
            assetIds: refs(model.protectedAssets, 1),
          }),
        )
        .max(60),
    });
  if (phase === 'report' && model)
    return schema.extend({
      roadmap: z
        .array(
          schema.shape.roadmap.element.extend({
            linkedIds: refs(
              [
                ...modelItems(model),
                ...(project.artifacts.stride?.data.threats || []),
                ...(project.artifacts.trees?.data.trees || []).flatMap((tree) => tree.nodes),
                ...(project.artifacts.coordination?.data.scenarios || []),
              ],
              1,
            ),
          }),
        )
        .max(100),
    });
  return schema;
}
