import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { DEFAULT_SCOPE } from './engine/schema.js';

const repositoryKey = (url) => url.replace(/\/+$/, '').replace(/\.git$/, '');

export async function openAssessment(engine, input) {
  const locator = input.kind === 'local' ? await realpath(input.path) : input.url;
  const reusable = ['local', 'git', 'url'].includes(input.kind);
  const key = input.kind === 'git' ? repositoryKey(locator) : locator;
  for (const summary of engine.list()) {
    const project = engine.get(summary.id);
    if (
      reusable &&
      project.sources.some(
        (source) =>
          source.kind === input.kind &&
          (input.kind === 'git' ? repositoryKey(source.locator) : source.locator) === key,
      )
    )
      return { project, reused: true };
  }
  const name = reusable
    ? path.basename(input.kind === 'local' ? locator : new URL(key).pathname)
    : input.label;
  const project = engine.create({
    name: name || 'Assessment',
    scope: DEFAULT_SCOPE,
  });
  try {
    return { project: await engine.addSource(project.id, input), reused: false };
  } catch (error) {
    // Failed intake must not accumulate empty assessments.
    if (!engine.closed) engine.remove(project.id);
    throw error;
  }
}
