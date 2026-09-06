import path from 'node:path';
import os from 'node:os';

export function sourceInput(value, cwd = process.cwd()) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Choose a source explicitly: a file, folder or public HTTPS URL.');
  let selected = value.trim();
  if (
    (selected.startsWith('"') && selected.endsWith('"')) ||
    (selected.startsWith("'") && selected.endsWith("'"))
  )
    selected = selected.slice(1, -1);
  if (!selected.trim()) throw new Error('Provide a file, directory or HTTPS repository path.');
  if (/^\w+:\/\//.test(selected)) {
    const url = new URL(selected);
    if (url.protocol !== 'https:') throw new Error('Use an HTTPS URL, or a local file/directory.');
    const repository = ['github.com', 'bitbucket.org'].includes(url.hostname)
      ? /^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)
      : url.hostname === 'gitlab.com' &&
        !url.pathname.includes('/-/') &&
        !/\.(pdf|docx?|md|txt)$/i.test(url.pathname);
    if (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) {
      url.hostname = 'raw.githubusercontent.com';
      url.pathname = url.pathname.replace('/blob/', '/');
    }
    url.hash = '';
    return { kind: repository ? 'git' : 'url', url: url.toString() };
  }
  if (selected === '~' || selected.startsWith('~/'))
    selected = path.join(os.homedir(), selected.slice(2));
  return { kind: 'local', path: path.resolve(cwd, selected) };
}
