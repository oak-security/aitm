import { z } from 'zod';

const text = z.string().max(12000);
const short = z.string().min(1).max(300);
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w.-]+$/);
const strings = z.array(text).max(200);
const ids = z.array(id).max(200);
const object = z.strictObject;
const evidence = object({
  fileId: id,
  startLine: z.int().min(1),
  endLine: z.int().min(1),
  quote: text,
});
const grounded = {
  evidence: z.array(evidence).max(20),
  assumption: text.describe('Explicit inference if evidence is absent; otherwise empty.'),
};
const item = object({ id, name: short, description: text, ...grounded });

export const PHASES = Object.freeze([
  { id: 'scope', title: 'Scope & source inventory', required: true, gate: false },
  { id: 'ingest', title: 'Ingest & classify', required: true, gate: false },
  { id: 'model', title: 'Construct TRACE model', required: true, gate: true },
  { id: 'stride', title: 'STRIDE & ranking', required: true, gate: true },
  { id: 'trees', title: 'Attack trees', required: false, gate: true },
  { id: 'coordination', title: 'Collusion & coordination', required: false, gate: true },
  { id: 'report', title: 'Roadmap & report', required: true, gate: true },
]);
export const PhaseId = z.enum(PHASES.map((p) => p.id));
export const ProviderId = z.enum(['openai', 'anthropic']);
// The fast slot reads every source batch; the deep slot reasons about STRIDE and
// coordination from the finished model. Verified against provider documentation
// on 2026-11-26; the account model list replaces the catalog when a key is set.
export const DEFAULT_MODELS = Object.freeze({
  openai: { fastModel: 'gpt-6.2-sol', deepModel: 'gpt-6.2-astra' },
  anthropic: { fastModel: 'claude-sonnet-5-5', deepModel: 'claude-opus-5-5' },
});
// Offered when the account model list is not available. Defaults come first.
export const MODEL_CATALOG = Object.freeze({
  openai: ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra', 'gpt-6-luna'],
  anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2', 'claude-haiku-5-5'],
});
export const Config = object({
  provider: ProviderId.default('openai'),
  fastModel: short.optional(),
  deepModel: short.optional(),
  effort: z.enum(['low', 'medium', 'high']).default('medium'),
  trees: z.boolean().default(true),
  coordination: z.enum(['auto', 'on', 'off']).default('auto'),
  treeLimit: z.int().min(1).max(10).default(3),
});
export function resolveConfig(input) {
  const config = Config.parse(input);
  return {
    ...config,
    fastModel: config.fastModel || DEFAULT_MODELS[config.provider].fastModel,
    deepModel: config.deepModel || DEFAULT_MODELS[config.provider].deepModel,
  };
}
export const DEFAULT_SCOPE =
  'Assess all added sources using TRACE. Identify threats, trust boundaries, protected assets and critical invariants. Flag undocumented assumptions and scope gaps for review.';
export const CreateProject = object({
  name: short,
  scope: text.default(''),
  config: Config.default(() => Config.parse({})),
});
export const UpdateProject = object({
  revision: z.int().min(1),
  name: short.optional(),
  scope: text.optional(),
  config: Config.optional(),
});
export const Review = object({
  revision: z.int().min(1),
  reviewer: z.string().trim().max(300).default(''),
  notes: text.default(''),
});
export const RunInput = object({
  mode: z.enum(['review', 'draft', 'full']).default('review'),
  resume: z.boolean().default(true),
  phase: PhaseId.exclude(['scope']).optional(),
}).refine((input) => input.mode !== 'full' || !input.phase, {
  message: 'Full pipeline runs cannot select a single phase.',
});
export const SourceInput = z.discriminatedUnion('kind', [
  object({ kind: z.literal('local'), path: short, label: short.optional() }),
  object({ kind: z.literal('git'), url: z.string().url().max(2000), label: short.optional() }),
  object({ kind: z.literal('url'), url: z.string().url().max(2000), label: short.optional() }),
  object({ kind: z.literal('text'), label: short, text: z.string().min(1).max(500000) }),
  object({
    kind: z.literal('files'),
    label: short,
    files: z
      .array(
        object({
          path: z.string().min(1).max(500),
          content: z.string().max(12000000),
          encoding: z.enum(['utf8', 'base64']).default('utf8'),
        }),
      )
      .min(1)
      .max(1000),
  }),
]);
export const Schemas = {
  scope: object({
    scope: text,
    inventory: z
      .array(object({ sourceId: id, label: short, hash: short, files: z.int().min(0) }))
      .max(100),
  }),
  ingest: object({
    summary: text,
    profile: short,
    pillars: z.array(z.enum(['protocols', 'systems', 'organisations'])).min(1),
    coordinatingActors: z.boolean(),
    rationale: text,
    candidates: z.array(item).max(100),
    missingEvidence: strings,
  }),
  model: object({
    overview: text,
    threatActors: z.array(item).max(100),
    roles: z.array(item).max(100),
    protectedAssets: z.array(item).min(1).max(100),
    invariants: z.array(item).min(1).max(100),
    components: z.array(item).min(1).max(100),
    edges: z
      .array(
        object({
          ...item.shape,
          from: id,
          to: id,
          kind: z.enum(['trust', 'value', 'data', 'authority']),
          boundary: text,
        }),
      )
      .max(200),
    openQuestions: strings,
  }),
  stride: object({
    threats: z
      .array(
        object({
          id,
          title: short,
          category: z.enum([
            'Spoofing',
            'Tampering',
            'Repudiation',
            'Information disclosure',
            'Denial of service',
            'Elevation of privilege',
          ]),
          scenario: text,
          targetIds: ids.min(1),
          actorIds: ids,
          assetIds: ids,
          invariantIds: ids,
          likelihood: z.int().min(1).max(5),
          impact: z.int().min(1).max(5),
          rationale: text,
          feasibility: text,
          incentives: text,
          blastRadius: text,
          timeSensitivity: text,
          confidence: z.enum(['low', 'medium', 'high']),
          existingControls: strings,
          mitigations: strings,
          ...grounded,
        }),
      )
      .max(120),
    coverage: z.array(object({ objectId: id, threatIds: ids, explanation: text })).max(400),
    openQuestions: strings,
  }),
  trees: object({
    trees: z
      .array(
        object({
          threatId: id,
          goal: short,
          nodes: z
            .array(
              object({
                id,
                parentId: id.nullable(),
                label: short,
                operator: z.enum(['AND', 'OR', 'LEAF']),
                prerequisites: strings,
                speculative: z.boolean(),
                mitigations: strings,
                ...grounded,
              }),
            )
            .min(1)
            .max(60),
        }),
      )
      .max(10),
    omitted: z.array(object({ threatId: id, reason: short })).max(120),
  }),
  coordination: object({
    scenarios: z
      .array(
        object({
          id,
          title: short,
          actorIds: ids.min(1),
          assetIds: ids.min(1),
          threshold: text,
          incentive: text,
          sharedDependencies: strings,
          consequence: text,
          mitigations: strings,
          ...grounded,
        }),
      )
      .max(60),
    assumptions: strings,
    openQuestions: strings,
  }),
  report: object({
    executiveSummary: text,
    roadmap: z
      .array(
        object({
          id,
          action: text,
          priority: z.enum(['immediate', '30 days', '60 days', '90 days']),
          owner: short,
          linkedIds: ids.min(1),
          verification: text,
        }),
      )
      .max(100),
    residualRisks: strings,
    openQuestions: strings,
    nextSteps: strings,
  }),
};

export function enabledPhases(project) {
  const model = project.artifacts.model?.data;
  const multipleActors = (model?.threatActors.length || 0) + (model?.roles.length || 0) > 1;
  const coordination =
    project.config.coordination === 'on' ||
    (project.config.coordination === 'auto' &&
      (project.artifacts.ingest?.data.coordinatingActors || multipleActors));
  return PHASES.filter(
    (p) =>
      p.required ||
      (p.id === 'trees' && project.config.trees) ||
      (p.id === 'coordination' && coordination),
  );
}

export function jsonSchema(schema, options = {}) {
  const result = z.toJSONSchema(schema, { target: 'draft-7', ...options });
  delete result.$schema;
  return result;
}
