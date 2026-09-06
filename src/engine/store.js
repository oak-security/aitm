import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  chmodSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { insist, AppError } from './errors.js';

export const now = () => new Date().toISOString();

export class Store {
  static async open(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    let release;
    try {
      release = await lockfile.lock(directory, { stale: 10000, retries: 0 });
    } catch {
      throw new AppError(
        409,
        'store_locked',
        'AiTM is already open with this data directory. Close that instance first, or use --data-dir for a separate assessment store.',
      );
    }
    try {
      return new Store(directory, release);
    } catch (error) {
      await release();
      throw error;
    }
  }
  constructor(directory, release) {
    this.directory = directory;
    this.release = release;
    this.projects = new Map();
    for (const file of readdirSync(directory).filter((f) => /^[0-9a-f-]{36}\.json$/.test(f))) {
      const project = JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
      insist(
        project.schemaVersion === 2 &&
          `${project.id}.json` === file &&
          project.artifacts &&
          Array.isArray(project.runs),
        `Invalid project file ${file}; restore it from a backup.`,
        500,
        'corrupt_store',
      );
      this.projects.set(project.id, project);
      let interrupted = false;
      for (const run of project.runs)
        if (['queued', 'running'].includes(run.status)) {
          run.status = 'interrupted';
          run.finishedAt = now();
          run.error = 'AiTM stopped during this run. Resume to retry the unfinished phase.';
          run.events.push({
            id: ++run.lastEventId,
            type: 'interrupted',
            at: now(),
            phase: run.phase,
            message: run.error,
          });
          interrupted = true;
        }
      if (interrupted) this.save(project);
    }
  }
  get(id) {
    const project = this.projects.get(id);
    insist(project, 'Project not found.', 404, 'not_found');
    return structuredClone(project);
  }
  list() {
    return [...this.projects.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        revision: p.revision,
        sources: p.sources.length,
        lastRun: p.runs.at(-1)?.status || null,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  save(project) {
    project.updatedAt = now();
    project.revision++;
    const target = path.join(this.directory, `${project.id}.json`),
      temporary = `${target}.tmp`;
    writeFileSync(temporary, JSON.stringify(project), { mode: 0o600, flag: 'w' });
    const fd = openSync(temporary, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, target);
    this.projects.set(project.id, structuredClone(project));
    return structuredClone(project);
  }
  remove(id) {
    this.get(id);
    unlinkSync(path.join(this.directory, `${id}.json`));
    this.projects.delete(id);
  }
  async close() {
    await this.release();
  }
}
