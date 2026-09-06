import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Select } from './select.js';
import { terminalText } from './logo.js';

const h = React.createElement;
export function FilePicker({
  title = 'Import documents or repository ZIPs',
  directory = process.cwd(),
  multiple = true,
  disabled = false,
  onSelect,
  onCancel,
}) {
  const [folder, setFolder] = useState(directory),
    [entries, setEntries] = useState([]),
    [selected, setSelected] = useState([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    readdir(folder, { withFileTypes: true })
      .then((items) => {
        if (current)
          setEntries(
            items
              .filter(
                (e) =>
                  !e.isSymbolicLink() &&
                  !e.name.startsWith('.') &&
                  !['node_modules', 'vendor'].includes(e.name),
              )
              .sort(
                (a, b) =>
                  Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
              ),
          );
      })
      .catch(() => {
        if (current) {
          setEntries([]);
          setError('Cannot read this folder. Choose its parent or Home.');
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [folder]);
  const options = [
    { value: ':import', label: `Import ${selected.length} selected file(s)` },
    { value: ':up', label: '.. Parent folder' },
    { value: ':home', label: '~ Home folder' },
    ...entries.map((entry) => ({
      value: entry.name,
      label: entry.isDirectory()
        ? `${entry.name}/`
        : `${selected.includes(path.join(folder, entry.name)) ? '[x]' : '[ ]'} ${entry.name}`,
    })),
  ];
  return h(
    Box,
    { flexDirection: 'column' },
    h(Text, { dimColor: true, wrap: 'truncate-end' }, terminalText(folder)),
    multiple
      ? h(
          Text,
          { color: '#FFC965', wrap: 'truncate-end' },
          `${selected.length} selected · Home then Enter to import`,
        )
      : null,
    loading
      ? h(Text, null, 'Reading file list…')
      : h(Select, {
          key: folder,
          title,
          disabled,
          options,
          hint: error || 'Enter opens a folder or imports a file. Space marks several files.',
          onSelect: (value) => {
            if (value === ':up') return setFolder(path.dirname(folder));
            if (value === ':home') return setFolder(os.homedir());
            if (value === ':import')
              return selected.length
                ? onSelect(selected)
                : setError('Mark files with Space, or select one with Enter.');
            const entry = entries.find((e) => e.name === value);
            if (entry?.isDirectory()) setFolder(path.join(folder, value));
            else if (entry?.isFile())
              onSelect([...new Set([...selected, path.join(folder, value)])]);
          },
          onToggle: multiple
            ? (value) => {
                if (!entries.find((entry) => entry.name === value)?.isFile()) return;
                const file = path.join(folder, value);
                setSelected((items) =>
                  items.includes(file) ? items.filter((p) => p !== file) : [...items, file],
                );
              }
            : undefined,
          onCancel,
        }),
  );
}
