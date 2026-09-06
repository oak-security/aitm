import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
function check(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) check(file);
    else if (file.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const dir of ['src', 'test', 'scripts']) check(dir);
console.log('JavaScript syntax checks passed.');
