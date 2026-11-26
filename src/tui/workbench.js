import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { readFile, stat } from 'node:fs/promises';
import { App, Form, keyFields, providerOptions, saveKey } from './app.js';
import { FilePicker } from './file-picker.js';
import { Select } from './select.js';
import { LOGO, terminalText } from './logo.js';
import { DEFAULT_SCOPE } from '../engine/schema.js';
import { sourceInput } from '../source-input.js';

const h = React.createElement;
export function Workbench({ engine, projectId, apiUrl, pickerDirectory, ...appProps }) {
  const { exit } = useApp(),
    { rows = 30 } = useWindowSize();
  // First run: analysis cannot start without a provider key, so begin in Settings.
  const unconfigured = () => !Object.values(engine.providers.status()).some((p) => p.configured);
  const [firstRun] = useState(() => !projectId && unconfigured());
  const [selected, setSelected] = useState(projectId),
    [screen, setScreen] = useState(projectId ? 'project' : firstRun ? 'settings' : 'home'),
    [keyProvider, setKeyProvider] = useState('openai'),
    [projects, setProjects] = useState(() => engine.list()),
    [notice, setNotice] = useState(
      projectId
        ? appProps.initialNotice || 'Project opened. v View report · o Projects.'
        : firstRun
          ? 'No API key is configured. Add one to run analysis, or press Esc to continue without.'
          : 'Create or open a project. No source is imported automatically.',
    ),
    [busy, setBusy] = useState(''),
    [sourceId, setSourceId] = useState(null),
    [replacement, setReplacement] = useState(null);
  useEffect(() => {
    const changed = () => setProjects(engine.list());
    engine.events.on('change', changed);
    return () => engine.events.off('change', changed);
  }, [engine]);
  const project = selected && projects.some((p) => p.id === selected) ? engine.get(selected) : null;
  useEffect(() => {
    if (selected && !project) {
      setSelected(null);
      setScreen('home');
      setNotice('Project removed. Create or open another project.');
    }
  }, [selected, project]);
  const back = () => setScreen(project ? 'project' : 'home');
  const open = (id) => {
    setSelected(id);
    setScreen('project');
    setNotice('Project opened. i Add sources · o Projects.');
  };
  const perform = async (label, task, next = 'project') => {
    if (busy) return;
    setBusy(label);
    setNotice('');
    try {
      const message = await task();
      setNotice(message || 'Saved.');
      setScreen(next);
    } catch (error) {
      setNotice(engine.providers.redact(error.message));
    } finally {
      setBusy('');
    }
  };
  const add = (inputs) =>
    perform('Importing selected sources…', async () => {
      if (replacement) {
        if (inputs.length !== 1)
          throw new Error('Choose one replacement source. Use Add sources for multiple imports.');
        await engine.addSource(selected, inputs[0], replacement);
      } else await engine.addSources(selected, inputs);
      setReplacement(null);
      return `${inputs.length} source(s) imported. i Add more · b Manage sources · f Run full pipeline.`;
    });
  const beginAdd = () => {
    setReplacement(null);
    setScreen('add');
  };
  useInput((input) => {
    if (
      screen === 'project' ||
      busy ||
      ['new', 'rename', 'path', 'url', 'delete', 'remove', 'files', 'import', 'key'].includes(
        screen,
      )
    )
      return;
    if (input === 'q') exit();
    if (input === 'n') setScreen('new');
    if (input === 'o') setScreen('open');
    if (input === 's') setScreen('settings');
    if (input === 'i' && project) beginAdd();
  });
  if (screen === 'project' && project)
    return h(App, {
      ...appProps,
      key: selected,
      engine,
      projectId: selected,
      apiUrl,
      initialNotice: notice || appProps.initialNotice,
      onProjects: () => setScreen('home'),
      onNewProject: () => setScreen('new'),
      onAddSources: beginAdd,
      onSources: () => setScreen('sources'),
    });
  let body;
  const choose = (title, options, onSelect, hint) =>
    h(Select, {
      key: screen + (sourceId || ''),
      title,
      options,
      onSelect,
      hint,
      onCancel: back,
      disabled: Boolean(busy),
    });
  const form = (title, fields, onSubmit) =>
    h(Form, { key: screen, title, fields, onSubmit, onCancel: back, disabled: Boolean(busy) });
  if (screen === 'new' || screen === 'rename')
    body = form(
      screen === 'new' ? 'New project' : 'Rename project',
      [
        { key: 'name', label: 'Project name', value: screen === 'rename' ? project.name : '' },
        ...(screen === 'new'
          ? [
              {
                key: 'scope',
                label: 'Scope (optional)',
                optional: true,
                hint: 'Describe the boundaries, or press Enter to use the TRACE default.',
              },
            ]
          : []),
      ],
      (values) =>
        perform(
          'Saving project…',
          () => {
            if (screen === 'rename')
              engine.update(selected, { revision: project.revision, name: values.name.trim() });
            else {
              const p = engine.create({
                name: values.name.trim(),
                scope: values.scope.trim() || DEFAULT_SCOPE,
              });
              setSelected(p.id);
              setReplacement(null);
            }
            return 'Project saved. Add the sources you want to assess.';
          },
          screen === 'new' ? 'add' : 'project',
        ),
    );
  else if (screen === 'settings')
    body = choose(
      'Settings · API keys',
      [
        ...providerOptions(engine),
        { value: ':test', label: 'Test the configured providers' },
        { value: ':back', label: project ? 'Back to project' : 'Back to projects' },
      ],
      (value) => {
        if (value === ':back') back();
        else if (value === ':test')
          perform(
            'Testing provider connections…',
            async () => {
              const configured = Object.entries(engine.providers.status()).filter(
                ([, status]) => status.configured,
              );
              if (!configured.length) throw new Error('Add an API key before you test.');
              for (const [provider, status] of configured)
                await engine.providers.test(provider, status.fastModel, AbortSignal.timeout(30000));
              return `Verified: ${configured.map(([provider]) => provider).join(', ')}.`;
            },
            'settings',
          );
        else {
          setKeyProvider(value);
          setScreen('key');
        }
      },
      engine.providers.keyFile
        ? `Saved privately: ${engine.providers.keyFile}. Models are set in each project (p).`
        : 'Keys apply to this session. Models are set in each project (p).',
    );
  else if (screen === 'key')
    body = h(Form, {
      key: `key-${keyProvider}`,
      title: `${keyProvider === 'openai' ? 'OpenAI' : 'Anthropic'} API key`,
      fields: keyFields(engine, keyProvider),
      onSubmit: (values) =>
        perform('Saving credentials…', () => saveKey(engine, keyProvider, values), 'settings'),
      onCancel: () => setScreen('settings'),
      disabled: Boolean(busy),
    });
  else if (screen === 'open')
    body = choose(
      'Open project',
      projects.length
        ? projects.map((p) => ({
            value: p.id,
            label: `${p.name} · ${p.sources} source(s) · ${p.lastRun || 'not run'}`,
          }))
        : [{ value: ':new', label: 'No saved projects — create a new project' }],
      (id) => (id === ':new' ? setScreen('new') : open(id)),
      'Saved projects retain their sources, reports and reviews.',
    );
  else if (screen === 'add')
    body = choose(
      replacement ? 'Replace selected source' : 'Add sources',
      [
        { value: 'url', label: 'Public URL · repository, document or ZIP' },
        { value: 'files', label: 'Browse files · documents or repository ZIPs' },
        { value: 'path', label: 'Enter local file or folder path' },
        { value: 'back', label: 'Back to project' },
      ],
      (mode) => (mode === 'back' ? back() : setScreen(mode)),
      `${project?.name} · ${project?.sources.length || 0} existing source(s)`,
    );
  else if (screen === 'path' || screen === 'url')
    body = form(
      screen === 'url' ? 'Import public URL' : 'Import local source',
      [
        {
          key: 'source',
          label: screen === 'url' ? 'HTTPS URL' : 'Path',
          hint: 'Choose an explicit source. Empty input does not import the current folder.',
        },
      ],
      ({ source }) => {
        let input;
        try {
          input = sourceInput(source);
          if (screen === 'url' && input.kind === 'local')
            throw new Error('Enter a public HTTPS URL.');
        } catch (error) {
          setNotice(error.message);
          return;
        }
        add([input]);
      },
    );
  else if (screen === 'files' || screen === 'import')
    body = h(FilePicker, {
      key: screen,
      directory: pickerDirectory,
      disabled: Boolean(busy),
      multiple: screen !== 'import',
      title: screen === 'import' ? 'Import a saved project JSON' : undefined,
      onCancel: back,
      onSelect: (files) =>
        screen === 'import'
          ? perform('Importing project…', async () => {
              if ((await stat(files[0])).size > 16 * 1024 * 1024)
                throw new Error('Project import exceeds 16 MiB.');
              const p = engine.import(JSON.parse(await readFile(files[0], 'utf8')));
              setSelected(p.id);
              return 'Project imported. Reviews need fresh approval.';
            })
          : add(files.map((file) => sourceInput(file))),
    });
  else if (screen === 'sources')
    body = choose(
      'Manage sources',
      [
        { value: ':add', label: '+ Add sources' },
        ...(project?.sources || []).map((s) => ({
          value: s.id,
          label: `${s.label} · ${s.kind} · ${s.files.length} file(s)`,
        })),
      ],
      (id) => {
        if (id === ':add') beginAdd();
        else {
          setSourceId(id);
          setScreen('source');
        }
      },
      'Choose a source to refresh, replace or remove.',
    );
  else if (screen === 'source') {
    const source = project?.sources.find((s) => s.id === sourceId);
    body = choose(
      source?.label || 'Source removed',
      [
        { value: 'replace', label: 'Replace this source' },
        ...(['local', 'git', 'url'].includes(source?.kind)
          ? [{ value: 'sync', label: 'Refresh snapshot' }]
          : []),
        { value: 'remove', label: 'Remove this source' },
        { value: 'sources', label: 'Back to sources' },
      ],
      (action) => {
        if (action === 'replace') {
          setReplacement(sourceId);
          setScreen('add');
        } else if (action === 'sync')
          perform('Refreshing snapshot…', () =>
            engine.syncSource(selected, sourceId).then(() => 'Source refreshed.'),
          );
        else setScreen(action);
      },
      `${source?.files.length || 0} file(s) · changes invalidate dependent analysis`,
    );
  } else if (screen === 'delete' || screen === 'remove')
    body = form(
      screen === 'delete' ? 'Delete project' : 'Remove source',
      [
        {
          key: 'confirm',
          label: `Type ${screen === 'delete' ? 'DELETE' : 'REMOVE'}`,
          hint:
            screen === 'delete'
              ? `Delete ${project?.name} and its saved assessment.`
              : 'Remove this snapshot and clear dependent analysis.',
        },
      ],
      ({ confirm }) =>
        perform(
          'Removing…',
          () => {
            if (screen === 'delete') {
              if (confirm !== 'DELETE') throw new Error('Type DELETE to confirm.');
              engine.remove(selected);
              setSelected(null);
            } else {
              if (confirm !== 'REMOVE') throw new Error('Type REMOVE to confirm.');
              engine.removeSource(selected, sourceId);
            }
            return 'Removed.';
          },
          screen === 'delete' ? 'home' : 'sources',
        ),
    );
  else
    body = choose(
      'Projects',
      [
        { value: 'new', label: 'New project' },
        { value: 'open', label: `Open project · ${projects.length} saved` },
        { value: 'import', label: 'Import project JSON' },
        { value: 'settings', label: 'Settings · API keys' },
        ...(project
          ? [
              { value: 'project', label: `Resume ${project.name}` },
              { value: 'rename', label: 'Rename current project' },
              { value: 'delete', label: 'Delete current project' },
              { value: 'close', label: 'Close current project' },
            ]
          : []),
      ],
      (mode) => {
        if (mode === 'close') {
          setSelected(null);
          setScreen('home');
        } else setScreen(mode);
      },
      'n New · o Open · s Settings · q Quit. Projects can contain several sources.',
    );
  return h(
    Box,
    { flexDirection: 'column', height: Math.max(1, rows - 1), overflow: 'hidden', paddingX: 1 },
    h(
      Box,
      { marginBottom: 1, flexShrink: 0 },
      h(Text, { color: '#FFC965' }, rows < 22 ? 'AiTM  o--o  / TRACE / Projects' : LOGO),
    ),
    h(Box, { flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }, body),
    h(
      Text,
      { dimColor: !busy, color: busy ? '#FFC965' : undefined, wrap: 'truncate-end' },
      terminalText(busy ? `↻ ${busy}` : notice),
    ),
  );
}
