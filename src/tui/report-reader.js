import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { markdownReport } from '../engine/report.js';
import { terminalText } from './logo.js';

const h = React.createElement;
const plain = (value) =>
  terminalText(value)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<br>/g, '\n')
    .replace(/\\\|/g, '|');

// Use the same assembled report as exports. Wide tables become readable records.
export function reportLines(markdown, width) {
  const lines = [];
  let headers = null;
  const add = (value, level = 0) => {
    for (let text of plain(value).split('\n')) {
      while (text.length > width) {
        const space = text.lastIndexOf(' ', width);
        const end = space > 0 ? space : width;
        lines.push({ text: text.slice(0, end), level });
        text = text.slice(end).trimStart();
      }
      lines.push({ text, level });
    }
  };
  const source = markdown.split('\n');
  const separator = /^\|(?:\s*:?-+:?\s*\|)+$/;
  for (const [index, line] of source.entries()) {
    if (headers && separator.test(line)) continue;
    if (line.startsWith('|') && (headers || separator.test(source[index + 1] || ''))) {
      const cells = line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((value) => value.trim());
      if (!headers) headers = cells;
      else {
        for (const [index, value] of cells.entries()) add(`${headers[index]}: ${value}`);
        add('');
      }
      continue;
    }
    headers = null;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) add(heading[2], heading[1].length);
    else add(line);
  }
  return lines;
}

export function ReportReader({ project, width, height, reviewCount = 0 }) {
  const lines = useMemo(() => reportLines(markdownReport(project), width), [project, width]);
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [project.id, project.artifacts.report.generatedAt]);
  const page = Math.max(1, height - 2);
  const last = Math.max(0, lines.length - page);
  const start = Math.min(offset, last);
  useInput((input, key) => {
    if (input === 'j') setOffset(Math.min(last, start + 1));
    if (input === 'k') setOffset(Math.max(0, start - 1));
    if (key.pageDown || input === ' ') setOffset(Math.min(last, start + page));
    if (key.pageUp) setOffset(Math.max(0, start - page));
    if (key.home) setOffset(0);
    if (key.end) setOffset(last);
    if (input === ']') {
      const next = lines.findIndex((line, index) => index > start && line.level === 2);
      setOffset(next < 0 ? last : Math.min(last, next));
    }
    if (input === '[') {
      const previous = lines.findLastIndex((line, index) => index < start && line.level === 2);
      setOffset(Math.max(0, previous));
    }
  });
  return h(
    Box,
    { flexDirection: 'column', height },
    h(
      Text,
      { color: '#D85CB4', bold: true, wrap: 'truncate-end' },
      `Markdown report · ${project.runs.at(-1)?.status === 'completed' ? 'Run complete' : 'Ready for review'}${reviewCount ? ` · ${reviewCount} source review note(s)` : ''} · ${start + 1}–${Math.min(lines.length, start + page)}/${lines.length}`,
    ),
    h(
      Box,
      { flexDirection: 'column', flexGrow: 1 },
      ...lines.slice(start, start + page).map((line, i) =>
        h(
          Text,
          {
            key: i,
            bold: Boolean(line.level),
            color: line.level ? '#FFC965' : undefined,
            wrap: 'truncate-end',
          },
          line.text || ' ',
        ),
      ),
    ),
    h(
      Text,
      { dimColor: true, wrap: 'truncate-end' },
      'j/k Scroll · PgUp/PgDn Page · [/] Section · Esc Menu',
    ),
  );
}
