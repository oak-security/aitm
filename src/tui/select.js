import React, { useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { terminalText } from './logo.js';

const h = React.createElement;

export function Select({
  title,
  options,
  value,
  hint,
  onSelect,
  onCancel,
  onToggle,
  disabled = false,
}) {
  const [index, setIndex] = useState(
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const { rows = 30 } = useWindowSize();
  const page = Math.max(3, Math.min(8, rows - 16));
  const start = Math.max(0, Math.min(index - Math.floor(page / 2), options.length - page));
  useInput(
    (input, key) => {
      if (key.escape) return onCancel();
      if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setIndex((i) => Math.min(options.length - 1, i + 1));
      if (key.pageUp) setIndex((i) => Math.max(0, i - page));
      if (key.pageDown) setIndex((i) => Math.min(options.length - 1, i + page));
      if (key.home) setIndex(0);
      if (key.end) setIndex(options.length - 1);
      if (key.return && options[index]) onSelect(options[index].value);
      if (input === ' ' && options[index]) onToggle?.(options[index].value);
    },
    { isActive: !disabled },
  );
  return h(
    Box,
    { flexDirection: 'column', borderStyle: 'round', borderColor: '#FFC965', paddingX: 1 },
    h(Text, { bold: true, color: '#FFC965', wrap: 'truncate-end' }, terminalText(title)),
    hint ? h(Text, { dimColor: true, wrap: 'truncate-end' }, terminalText(hint)) : null,
    ...options.slice(start, start + page).map((option, offset) =>
      h(
        Text,
        {
          key: option.value,
          color: start + offset === index ? '#FFC965' : undefined,
          bold: start + offset === index,
          wrap: 'truncate-end',
        },
        `${start + offset === index ? '>' : ' '} ${terminalText(option.label)}`,
      ),
    ),
    h(
      Text,
      { dimColor: true },
      `Up/Down · Enter Select · ${onToggle ? 'Space Mark · ' : ''}Esc Cancel · ${index + 1}/${options.length}`,
    ),
  );
}
