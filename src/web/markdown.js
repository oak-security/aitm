import { esc } from './html.js';

// Deliberately small, inert Markdown renderer for the engine's report format.
// HTML, links and images from source material remain text; no remote resources.
const inline = (text) =>
  esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/&lt;br\s*\/?&gt;/g, '<br>')
    .replace(/\\\|/g, '|');
export function markdown(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const result = [],
    headings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const code = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      result.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (/^#{1,6} /.test(line)) {
      const [, marks, title] = /^(#+) (.*)$/.exec(line),
        id = `section-${headings.length}`;
      headings.push({ id, title, level: marks.length });
      result.push(`<h${marks.length} id="${id}">${inline(title)}</h${marks.length}>`);
    } else if (line.startsWith('|') && /^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[i + 1] || '')) {
      const cells = (row, tag) =>
        `<tr>${row
          .slice(1, -1)
          .split(/(?<!\\)\|/)
          .map((c) => `<${tag}>${inline(c.trim())}</${tag}>`)
          .join('')}</tr>`;
      const rows = [];
      i++;
      while (i + 1 < lines.length && lines[i + 1].startsWith('|'))
        rows.push(cells(lines[++i], 'td'));
      result.push(
        `<div class="table-wrap"><table><thead>${cells(line, 'th')}</thead><tbody>${rows.join('')}</tbody></table></div>`,
      );
    } else if (/^[-*] /.test(line)) {
      const items = [line];
      while (/^[-*] /.test(lines[i + 1] || '')) items.push(lines[++i]);
      result.push(`<ul>${items.map((s) => `<li>${inline(s.slice(2))}</li>`).join('')}</ul>`);
    } else result.push(`<p>${inline(line)}</p>`);
  }
  return { html: result.join('\n'), headings };
}
