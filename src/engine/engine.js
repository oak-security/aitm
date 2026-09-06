import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { Store, now } from './store.js';
import { AppError, insist, parse } from './errors.js';
import {
  PHASES,
  CreateProject,
  UpdateProject,
  Review,
  RunInput,
  PhaseId,
  Schemas,
  enabledPhases,
  resolveConfig,
} from './schema.js';
import { ingest, LIMITS } from './ingest.js';
import { validateArtifact, resolveEvidence, resolveCoverage } from './validate.js';
import { promptFor } from './prompts.js';
import { Providers } from './providers.js';

const artifact = (data, runId = null, generation = null) => ({
  data,
  status: 'draft',
  review: null,
  generatedAt: now(),
  runId,
  generation,
});
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'awaiting_review']);

export class Engine {
  static async open({ dataDir, providers = new Providers() }) {
    return new Engine(await Store.open(dataDir), providers);
  }
  constructor(store, providers) {
    this.store = store;
    this.providers = providers;
    this.events = new EventEmitter();
    this.events.setMaxListeners(100);
    this.active = new Map();
    this.closed = false;
  }
  get(id) {
    return this.store.get(id);
  }
  list() {
    return this.store.list();
  }
  save(p) {
    return this.store.save(JSON.parse(this.providers.redact(JSON.stringify(p))));
  }
  idle(id) {
    insist(!this.closed, 'Engine is stopping.', 503);
    insist(
      !this.active.has(id),
      'This project has an operation in progress. Wait or cancel its run before editing.',
      409,
      'project_busy',
    );
  }
  revision(project, expected) {
    insist(
      project.revision === expected,
      'Project changed. Refresh and apply your edit again.',
      409,
      'revision_conflict',
    );
  }
  audit(p, action, detail) {
    p.audit.push({ at: now(), action, detail });
  }
  invalidate(p, from) {
    const index = PHASES.findIndex((x) => x.id === from);
    for (const phase of PHASES.slice(index)) delete p.artifacts[phase.id];
  }
  inventory(p) {
    this.invalidate(p, 'scope');
    p.artifacts.scope = artifact({
      scope: p.scope,
      inventory: p.sources.map((s) => ({
        sourceId: s.id,
        label: s.label,
        hash: s.hash,
        files: s.files.length,
      })),
    });
  }
  create(input) {
    insist(!this.closed, 'Engine is stopping.', 503);
    const data = parse(CreateProject, input);
    data.config = resolveConfig(data.config);
    const p = {
      schemaVersion: 2,
      id: randomUUID(),
      ...data,
      revision: 0,
      createdAt: now(),
      updatedAt: now(),
      sources: [],
      artifacts: {},
      runs: [],
      audit: [],
    };
    this.inventory(p);
    return this.save(p);
  }
  update(id, raw) {
    this.idle(id);
    const input = parse(UpdateProject, raw),
      p = this.get(id);
    this.revision(p, input.revision);
    if (input.name !== undefined) p.name = input.name;
    if (input.scope !== undefined && p.scope !== input.scope) {
      p.scope = input.scope;
      this.inventory(p);
    }
    if (input.config && JSON.stringify(input.config) !== JSON.stringify(p.config)) {
      p.config = resolveConfig(input.config);
      this.invalidate(p, 'ingest');
    }
    this.audit(p, 'project.updated', 'Project settings or scope updated.');
    return this.save(p);
  }
  remove(id) {
    this.idle(id);
    this.store.remove(id);
  }
  async addSource(id, input, replaceId = null) {
    this.idle(id);
    const p = this.get(id);
    insist(replaceId || p.sources.length < 100, 'A project supports at most 100 sources.');
    if (replaceId)
      insist(
        p.sources.some((s) => s.id === replaceId),
        'Source not found.',
        404,
      );
    const controller = new AbortController();
    const task = (async () => {
      const source = await ingest(input, {
        sourceId: replaceId || randomUUID(),
        signal: controller.signal,
      });
      const sanitized = JSON.parse(this.providers.redact(JSON.stringify(source)));
      for (const file of sanitized.files) file.lines = file.text.split('\n').length;
      const unchanged = replaceId && p.sources.find((s) => s.id === replaceId).hash === source.hash;
      p.sources = [...p.sources.filter((s) => s.id !== replaceId), sanitized];
      insist(
        p.sources.flatMap((s) => s.files).length <= LIMITS.projectFiles,
        'Project exceeds the 2000 file limit. Narrow the source scope.',
      );
      insist(
        p.sources.flatMap((s) => s.files).reduce((n, f) => n + f.text.length, 0) <=
          LIMITS.projectChars,
        'Project evidence exceeds 1 million characters. Narrow the source scope.',
      );
      if (!unchanged) this.inventory(p);
      this.audit(p, unchanged ? 'sources.checked' : 'sources.changed', sanitized.label);
      return this.save(p);
    })();
    this.active.set(id, { controller, task });
    try {
      return await task;
    } finally {
      this.active.delete(id);
    }
  }
  async syncSource(id, sourceId) {
    const source = this.get(id).sources.find((s) => s.id === sourceId);
    insist(source, 'Source not found.', 404);
    insist(
      ['local', 'git'].includes(source.kind),
      'Replace text or synced-file sources with PUT /sources/:id.',
    );
    return this.addSource(
      id,
      {
        kind: source.kind,
        label: source.label,
        ...(source.kind === 'local' ? { path: source.locator } : { url: source.locator }),
      },
      sourceId,
    );
  }
  removeSource(id, sourceId) {
    this.idle(id);
    const p = this.get(id);
    insist(
      p.sources.some((s) => s.id === sourceId),
      'Source not found.',
      404,
    );
    p.sources = p.sources.filter((s) => s.id !== sourceId);
    this.inventory(p);
    this.audit(p, 'sources.removed', sourceId);
    return this.save(p);
  }
  editArtifact(id, phase, input) {
    this.idle(id);
    parse(PhaseId, phase);
    const p = this.get(id);
    const patch = parse(z.strictObject({ revision: z.int(), data: Schemas[phase] }), input);
    this.revision(p, patch.revision);
    insist(phase !== 'scope', 'Edit scope through the project settings.');
    insist(p.artifacts[phase], 'Generate this phase before editing.', 409);
    const data = validateArtifact(phase, patch.data, p);
    this.invalidate(p, phase);
    p.artifacts[phase] = artifact(data);
    this.audit(p, 'artifact.edited', phase);
    return this.save(p);
  }
  approve(id, phase, raw) {
    this.idle(id);
    parse(PhaseId, phase);
    const input = parse(Review, raw),
      p = this.get(id);
    this.revision(p, input.revision);
    insist(p.artifacts[phase], 'No artifact exists for this phase.', 409);
    if (phase === 'scope')
      insist(
        p.sources.length && p.scope.trim(),
        'Add source evidence and define the assessment scope before approving.',
      );
    for (const prior of enabledPhases(p)) {
      if (prior.id === phase) break;
      insist(
        p.artifacts[prior.id] && (!prior.gate || p.artifacts[prior.id].status === 'approved'),
        `Review ${prior.title} first.`,
        409,
        'review_required',
      );
    }
    p.artifacts[phase].status = 'approved';
    p.artifacts[phase].review = { reviewer: input.reviewer, notes: input.notes, at: now() };
    this.audit(p, 'artifact.approved', { phase, ...p.artifacts[phase].review });
    return this.save(p);
  }
  run(id, raw = {}) {
    this.idle(id);
    insist(!this.closed, 'Engine is stopping.', 503);
    const input = parse(RunInput, raw),
      p = this.get(id);
    insist(
      p.sources.length > 0 && p.scope.trim(),
      'Define a scope and add at least one source before running.',
    );
    this.providers.assertConfigured(p.config.provider);
    if (input.phase) {
      insist(
        enabledPhases(p).some((x) => x.id === input.phase),
        'This phase is disabled.',
      );
      for (const prior of enabledPhases(p)) {
        if (prior.id === input.phase) break;
        insist(p.artifacts[prior.id], `Generate ${prior.title} first.`, 409, 'dependency_missing');
        if (input.mode === 'review' && prior.gate)
          insist(
            p.artifacts[prior.id].status === 'approved',
            `Review ${prior.title} first.`,
            409,
            'review_required',
          );
      }
      this.invalidate(p, input.phase);
    } else if (!input.resume) this.invalidate(p, 'ingest');
    const run = {
      id: randomUUID(),
      status: 'queued',
      mode: input.mode,
      phase: null,
      createdAt: now(),
      finishedAt: null,
      error: null,
      events: [],
      lastEventId: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    p.runs.push(run);
    this.save(p);
    const controller = new AbortController();
    // Schedule after the active slot is reserved, including synchronous fake providers.
    const task = Promise.resolve()
      .then(() => this.execute(id, run.id, input, controller.signal))
      .finally(() => this.active.delete(id));
    this.active.set(id, { controller, task, runId: run.id });
    return structuredClone(run);
  }
  emit(id, runId, type, phase, message, extra = {}) {
    const p = this.get(id),
      run = p.runs.find((r) => r.id === runId);
    const event = { id: ++run.lastEventId, type, at: now(), phase, message, ...extra };
    run.events.push(event);
    this.save(p);
    this.events.emit(runId, event);
  }
  status(id, runId, status, phase = null, error = null) {
    const p = this.get(id),
      run = p.runs.find((r) => r.id === runId);
    run.status = status;
    run.phase = phase;
    run.error = error;
    if (terminal.has(status)) run.finishedAt = now();
    this.save(p);
    this.emit(id, runId, status, phase, error || status.replaceAll('_', ' '));
  }
  async execute(id, runId, input, signal) {
    try {
      this.status(id, runId, 'running');
      for (const phase of PHASES) {
        signal.throwIfAborted();
        let p = this.get(id);
        if (!enabledPhases(p).some((x) => x.id === phase.id)) {
          this.emit(id, runId, 'skipped', phase.id, 'Optional phase disabled or not applicable.');
          continue;
        }
        if (input.phase && phase.id !== input.phase) continue;
        if (!p.artifacts[phase.id]) {
          this.status(id, runId, 'running', phase.id);
          const deep = ['stride', 'coordination'].includes(phase.id);
          const prompt = promptFor(phase.id, p),
            context = JSON.parse(prompt.user);
          const usage = { inputTokens: 0, outputTokens: 0 };
          let result,
            data,
            evidenceCorrections = [],
            coverageCorrections = [],
            attempts = 0;
          for (; attempts < 2; attempts++) {
            result = await this.providers.call({
              provider: p.config.provider,
              model: deep ? p.config.deepModel : p.config.fastModel,
              phase: phase.id,
              effort: p.config.effort,
              ...prompt,
              user: JSON.stringify(context),
              signal,
              onProgress: (progress) =>
                this.emit(id, runId, 'progress', phase.id, `Receiving ${phase.title}`, progress),
            });
            signal.throwIfAborted();
            p = this.get(id);
            const run = p.runs.find((r) => r.id === runId);
            for (const key of ['inputTokens', 'outputTokens']) {
              usage[key] += result.usage[key];
              run.usage[key] += result.usage[key];
            }
            this.save(p);
            try {
              const resolved = resolveEvidence(phase.id, result.data, p);
              coverageCorrections = phase.id === 'stride' ? resolveCoverage(resolved.data, p) : [];
              data = validateArtifact(phase.id, resolved.data, p);
              evidenceCorrections = resolved.corrections;
              break;
            } catch (error) {
              if (attempts || !(error instanceof AppError) || error.status !== 422) throw error;
              context.correction = {
                instruction:
                  'Correct the previous artifact to satisfy the schema and evidence/reference checks. Return the entire corrected artifact.',
                validationError: error.message,
                previousArtifact: result.data,
              };
              this.emit(
                id,
                runId,
                'validation_retry',
                phase.id,
                'Correcting an invalid artifact; it has not been published.',
                { validationError: this.providers.redact(error.message) },
              );
            }
          }
          p = this.get(id);
          p.artifacts[phase.id] = artifact(data, runId, {
            provider: result.provider,
            model: result.model,
            usage,
            attempts: attempts + 1,
            evidenceCorrections,
            coverageCorrections,
          });
          this.save(p);
          this.emit(id, runId, 'artifact', phase.id, `${phase.title} ready for review.`);
        }
        p = this.get(id);
        if (input.mode === 'review' && phase.gate && p.artifacts[phase.id].status !== 'approved') {
          this.status(id, runId, 'awaiting_review', phase.id);
          return;
        }
      }
      this.status(id, runId, 'completed');
    } catch (error) {
      if (signal.aborted) this.status(id, runId, 'cancelled');
      else
        this.status(
          id,
          runId,
          'failed',
          this.get(id).runs.find((r) => r.id === runId).phase,
          error instanceof AppError
            ? this.providers.redact(error.message)
            : 'Analysis failed unexpectedly. Retry the unfinished phase.',
        );
    }
  }
  getRun(id, runId) {
    const run = this.get(id).runs.find((r) => r.id === runId);
    insist(run, 'Run not found.', 404);
    return run;
  }
  async cancel(id, runId) {
    this.getRun(id, runId);
    const active = this.active.get(id);
    if (active?.runId === runId) {
      active.controller.abort();
      await active.task;
    }
    return this.getRun(id, runId);
  }
  export(id) {
    return { format: 'aitm-project', version: 2, project: this.get(id) };
  }
  import(raw) {
    insist(!this.closed, 'Engine is stopping.', 503);
    const envelope = parse(
      z.strictObject({
        format: z.literal('aitm-project'),
        version: z.literal(2),
        project: z.record(z.string(), z.unknown()),
      }),
      raw,
    );
    const old = envelope.project;
    insist(old.schemaVersion === 2, 'Unsupported project schema version.');
    const input = parse(CreateProject, { name: old.name, scope: old.scope, config: old.config });
    input.config = resolveConfig(input.config);
    const sourceSchema = z.strictObject({
      id: z.uuid(),
      kind: z.enum(['local', 'git', 'text', 'files']),
      label: z.string().min(1).max(300),
      locator: z.string().nullable(),
      commit: z.string().nullable(),
      hash: z.string(),
      collectedAt: z.iso.datetime(),
      files: z
        .array(
          z.strictObject({
            id: z.string().regex(/^file-[a-f0-9]{20}$/),
            path: z.string().max(500),
            hash: z.string(),
            bytes: z.int().nonnegative(),
            text: z.string().max(LIMITS.fileChars),
            lines: z.int().min(1),
          }),
        )
        .min(1)
        .max(LIMITS.files),
      warnings: z.array(z.string().max(2000)).max(100),
    });
    const sources = parse(z.array(sourceSchema).max(100), old.sources);
    const sourceIds = new Set(),
      fileIds = new Set();
    let chars = 0;
    for (const source of sources) {
      insist(!sourceIds.has(source.id), 'Duplicate source ID.');
      sourceIds.add(source.id);
      // Imported projects are portable snapshots; syncing a local path requires re-adding it explicitly.
      source.kind = 'files';
      source.locator = null;
      for (const file of source.files) {
        insist(!fileIds.has(file.id), 'Duplicate file ID.');
        fileIds.add(file.id);
        chars += file.text.length;
        insist(file.lines === file.text.split('\n').length, 'Incorrect source line count.');
      }
    }
    insist(chars <= LIMITS.projectChars, 'Imported evidence exceeds the project size limit.');
    insist(fileIds.size <= LIMITS.projectFiles, 'Imported evidence exceeds the 2000 file limit.');
    const p = {
      schemaVersion: 2,
      id: randomUUID(),
      ...input,
      sources,
      revision: 0,
      createdAt: now(),
      updatedAt: now(),
      artifacts: {},
      runs: [],
      audit: [],
    };
    this.inventory(p);
    for (const phase of PHASES.slice(1))
      if (old.artifacts?.[phase.id]) {
        insist(
          enabledPhases(p).some((x) => x.id === phase.id),
          'Imported project contains a disabled phase.',
        );
        const prior = enabledPhases(p).slice(
          0,
          enabledPhases(p).findIndex((x) => x.id === phase.id),
        );
        insist(
          prior.every((x) => p.artifacts[x.id]),
          'Imported artifact is missing a dependency.',
        );
        p.artifacts[phase.id] = artifact(
          validateArtifact(phase.id, old.artifacts[phase.id].data, p),
        );
      }
    this.audit(
      p,
      'project.imported',
      'Portable snapshot imported; review decisions require fresh approval.',
    );
    const serialized = JSON.stringify(p);
    insist(
      this.providers.redact(serialized) === serialized,
      'Import contains a configured provider credential.',
    );
    return this.save(p);
  }
  async close() {
    this.closed = true;
    for (const active of this.active.values()) active.controller.abort();
    await Promise.allSettled([...this.active.values()].map((a) => a.task));
    await this.store.close();
  }
}
