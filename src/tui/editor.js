import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

export async function editJSON(value, suspendTerminal) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aitm-edit-'));
  const file = path.join(directory, 'artifact.json');
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const command = process.env.VISUAL || process.env.EDITOR || 'vi';
  const args = (command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).map((s) =>
    s.replace(/^(["'])(.*)\1$/, '$2'),
  );
  try {
    await suspendTerminal(
      () =>
        new Promise((resolve, reject) => {
          const child = spawn(args[0], [...args.slice(1), file], {
            stdio: 'inherit',
            shell: false,
          });
          child.once('error', reject);
          child.once('exit', (code) =>
            code === 0 ? resolve() : reject(new Error(`Editor exited with code ${code}.`)),
          );
        }),
    );
    const edited = JSON.parse(await readFile(file, 'utf8'));
    await rm(directory, { recursive: true, force: true });
    return edited;
  } catch (error) {
    throw new Error(`${error.message} Your edit is preserved at ${file}.`);
  }
}
