import { readFile } from 'node:fs/promises';

// Explicit public assets: never resolve an arbitrary URL against the filesystem.
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ...['app.js', 'views.js', 'html.js', 'markdown.js'].map((file) => [
    `/ui/${file}`,
    [file, 'text/javascript; charset=utf-8'],
  ]),
  ['/ui/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ...['aitm-mark.svg', 'oak-white.svg'].map((file) => [
    `/ui/assets/${file}`,
    [`assets/${file}`, 'image/svg+xml'],
  ]),
  ...['Regular', 'Medium', 'Bold'].map((weight) => {
    const file = `assets/BDOGrotesk-${weight}.woff2`;
    return [`/ui/${file}`, [file, 'font/woff2']];
  }),
]);
export async function serveWeb(req, res, pathname) {
  const asset = assets.get(pathname);
  if (!asset || !['GET', 'HEAD'].includes(req.method)) return false;
  const content = await readFile(new URL(`../web/${asset[0]}`, import.meta.url));
  res.writeHead(200, {
    'content-type': asset[1],
    'content-length': content.length,
    'content-security-policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  });
  res.end(req.method === 'HEAD' ? undefined : content);
  return true;
}
