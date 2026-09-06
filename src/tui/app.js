import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import TextInput from 'ink-text-input';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { LOGO, TAGLINE, terminalText } from './logo.js';
import { editJSON } from './editor.js';

const h = React.createElement;
const GOLD = '#FFC965',
  MAGENTA = '#D85CB4';
const running = (p) => p?.runs.findLast((r) => ['running', 'queued'].includes(r.status));
const label = (value) => terminalText(value);

function Form({ title, fields, onSubmit, onCancel }) {
  const [index, setIndex] = useState(0),
    [values, setValues] = useState({}),
    [value, setValue] = useState(fields[0].value || '');
  useInput((input, key) => {
    if (key.escape) onCancel();
  });
  const field = fields[index];
  return h(
    Box,
    { flexDirection: 'column', borderStyle: 'round', borderColor: GOLD, paddingX: 2, paddingY: 1 },
    h(Text, { bold: true, color: GOLD }, title),
    h(
      Text,
      { dimColor: true },
      `${index + 1}/${fields.length}  ${field.hint || 'Enter to continue. Escape to cancel.'}`,
    ),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: MAGENTA }, `${field.label}: `),
      h(TextInput, {
        value,
        onChange: setValue,
        onSubmit: () => {
          const next = { ...values, [field.key]: value };
          if (!value.trim() && !field.optional) return;
          if (index === fields.length - 1) onSubmit(next);
          else {
            setValues(next);
            setIndex(index + 1);
            setValue(fields[index + 1].value || '');
          }
        },
      }),
    ),
  );
}

export function artifactText(phase, project) {
  if (phase === 'scope')
    return [
      `SCOPE`,
      project.scope || 'Set scope with e.',
      '',
      'SOURCES',
      ...project.sources.flatMap((s, i) => [
        `${i + 1}. ${s.label} [${s.kind}] — ${s.files.length} files`,
        `   ${s.locator || 'Synced snapshot'}${s.commit ? ` @ ${s.commit.slice(0, 12)}` : ''}`,
        ...s.warnings.map((w) => `   Warning: ${w}`),
      ]),
      '',
      's Add path/repository   t Add notes   u Sync sources',
      'd Remove source   e Edit scope/settings',
    ].join('\n');
  const a = project.artifacts[phase];
  if (!a)
    return 'No artifact yet.\n\nr  Run / resume with review gates\nf  Generate a full draft\n\nSource excerpts are sent to your selected AI provider.';
  function pretty(value, depth = 0) {
    if (Array.isArray(value))
      return value.map((v) => (typeof v === 'object' ? pretty(v, depth) : `- ${v}`)).join('\n\n');
    if (value && typeof value === 'object')
      return Object.entries(value)
        .map(([key, v]) => {
          const name = key.replace(/([a-z])([A-Z])/g, '$1 $2');
          if (typeof v === 'object' && v !== null)
            return `${name.toUpperCase()}\n${pretty(v, depth + 1)}`;
          return `${name}: ${v ?? 'root'}`;
        })
        .join('\n');
    return String(value);
  }
  return `${a.status.toUpperCase()}${a.review ? ` — ${a.review.reviewer}` : ' — awaiting expert review'}\n\n${pretty(a.data)}`;
}

export function App({
  client,
  initialProjectId = null,
  pollMs = 1500,
  editor = editJSON,
  exportDir = process.cwd(),
}) {
  const { exit, suspendTerminal } = useApp();
  const { columns = 100, rows = 30 } = useWindowSize();
  const [projects, setProjects] = useState([]),
    [project, setProject] = useState(null),
    [projectId, setProjectId] = useState(initialProjectId);
  const [meta, setMeta] = useState(null),
    [providers, setProviders] = useState({}),
    [selected, setSelected] = useState(0),
    [phaseIndex, setPhaseIndex] = useState(0);
  const [offset, setOffset] = useState(0),
    [form, setForm] = useState(null),
    [notice, setNotice] = useState('Connecting to the engine…'),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(null),
    [detail, setDetail] = useState('artifact');
  const mounted = useRef(true),
    requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const [list, state, details, keys] = await Promise.all([
        client.get('/v1/projects'),
        projectId ? client.get(client.projectPath(projectId)) : null,
        client.get('/v1/meta'),
        client.get('/v1/providers'),
      ]);
      if (!mounted.current || version !== requestVersion.current) return;
      setProjects(list);
      setProject(state);
      setMeta(details);
      setProviders(keys);
      setNotice((previous) =>
        previous.startsWith('Connecting') || previous.startsWith('Cannot reach')
          ? 'Ready.'
          : previous,
      );
    } catch (error) {
      if (mounted.current) setNotice(error.message);
    }
  }, [client, projectId]);
  useEffect(() => {
    mounted.current = true;
    refresh();
    const timer = setInterval(refresh, pollMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh, pollMs]);
  const live = running(project);
  useEffect(() => {
    if (!live || !projectId) {
      setProgress(null);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        for await (const event of client.events(projectId, live.id, {
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) return;
          setProgress(event);
          if (event.type !== 'progress') refresh();
        }
      } catch (error) {
        if (!controller.signal.aborted) setNotice(error.message);
      }
    })();
    return () => controller.abort();
  }, [client, projectId, live?.id, refresh]);
  const phases = (meta?.phases || []).filter(
    (p) =>
      p.required ||
      (p.id === 'trees' && project?.config.trees) ||
      (p.id === 'coordination' &&
        (project?.config.coordination === 'on' ||
          (project?.config.coordination === 'auto' &&
            project?.artifacts.ingest?.data.coordinatingActors))),
  );
  const phase = phases[Math.min(phaseIndex, phases.length - 1)];
  const act = async (action) => {
    if (busy) return;
    setBusy(true);
    setForm(null);
    try {
      const message = await action();
      setNotice(message || 'Saved.');
      await refresh();
    } catch (error) {
      setNotice(error.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const show = (title, fields, submit) =>
    setForm({ title, fields, onSubmit: (values) => act(() => submit(values)) });
  const newProject = () =>
    show(
      'New assessment',
      [
        { key: 'name', label: 'Name' },
        {
          key: 'scope',
          label: 'Scope',
          hint: 'Describe the system, boundaries, exclusions and known assumptions.',
        },
      ],
      async (values) => {
        const p = await client.post('/v1/projects', values);
        setProjectId(p.id);
        setProject(p);
        setPhaseIndex(0);
        return 'Project created. Press s to add evidence.';
      },
    );
  const run = (mode, resume = true, selectedPhase = undefined) =>
    act(async () => {
      const r = await client.post(`${client.projectPath(project.id)}/runs`, {
        mode,
        resume,
        ...(selectedPhase ? { phase: selectedPhase } : {}),
      });
      return `${mode === 'draft' ? 'Draft' : 'Review'} run started: ${r.id.slice(0, 8)}. Source excerpts are sent to ${project.config.provider}.`;
    });
  useInput((input, key) => {
    if (form || busy) return;
    if (input === 'q') {
      exit();
      return;
    }
    if (key.escape) {
      setProjectId(null);
      setProject(null);
      setOffset(0);
      return;
    }
    if (input === 'n') {
      newProject();
      return;
    }
    if (input === 'R') {
      refresh();
      return;
    }
    if (!project) {
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelected((i) => Math.min(projects.length - 1, i + 1));
      if (key.return && projects[selected]) {
        setProjectId(projects[selected].id);
        setPhaseIndex(0);
        setOffset(0);
      }
      if (input === 'D' && projects[selected])
        show(
          'Delete assessment',
          [
            {
              key: 'confirm',
              label: 'Type DELETE',
              hint: `Permanently remove ${label(projects[selected].name)} and its saved analysis.`,
            },
          ],
          async ({ confirm }) => {
            if (confirm !== 'DELETE') return 'Deletion cancelled.';
            await client.request('DELETE', client.projectPath(projects[selected].id));
            setSelected(0);
            return 'Assessment deleted.';
          },
        );
      if (input === 'i')
        show('Import project', [{ key: 'file', label: 'JSON path' }], async ({ file }) => {
          const { readFile } = await import('node:fs/promises');
          const imported = await client.post(
            '/v1/projects/import',
            JSON.parse(await readFile(path.resolve(file), 'utf8')),
          );
          setProjectId(imported.id);
          return 'Project imported; artifacts require fresh review.';
        });
      return;
    }
    const base = client.projectPath(project.id);
    if (key.upArrow) {
      setPhaseIndex((i) => Math.max(0, i - 1));
      setOffset(0);
      setDetail('artifact');
    }
    if (key.downArrow) {
      setPhaseIndex((i) => Math.min(phases.length - 1, i + 1));
      setOffset(0);
      setDetail('artifact');
    }
    if (input === 'l') {
      setDetail((value) => (value === 'log' ? 'artifact' : 'log'));
      setOffset(0);
    }
    if (input === '?') {
      setDetail((value) => (value === 'help' ? 'artifact' : 'help'));
      setOffset(0);
    }
    if (key.pageDown || input === 'j') setOffset((i) => i + Math.max(1, rows - 16));
    if (key.pageUp || input === 'k') setOffset((i) => Math.max(0, i - Math.max(1, rows - 16)));
    if (input === 'r') run('review');
    if (input === 'f') run('draft');
    if (input === 'g' && phase?.id !== 'scope') run('review', true, phase.id);
    if (input === 'F')
      show(
        'Restart full draft',
        [
          {
            key: 'confirm',
            label: 'Type RESTART',
            hint: 'This clears generated analysis and reviews; source evidence and scope are kept.',
          },
        ],
        async ({ confirm }) => {
          if (confirm !== 'RESTART') return 'Restart cancelled.';
          await client.post(`${base}/runs`, { mode: 'draft', resume: false });
          return 'Full draft restarted.';
        },
      );
    if (input === 'c' && live)
      act(async () => {
        await client.post(`${base}/runs/${live.id}/cancel`);
        return 'Run cancelled; completed artifacts are saved.';
      });
    if (input === 's')
      show(
        'Add source',
        [
          {
            key: 'source',
            label: 'Path / HTTPS Git URL',
            hint: 'Folder, code file, PDF, DOCX, or public GitHub/GitLab/Bitbucket repository.',
          },
        ],
        async ({ source }) => {
          await client.post(
            `${base}/sources`,
            /^https:\/\//.test(source)
              ? { kind: 'git', url: source }
              : { kind: 'local', path: path.resolve(source) },
          );
          return 'Source snapshot added. Review the updated inventory.';
        },
      );
    if (input === 't')
      show(
        'Add notes or specification',
        [
          { key: 'label', label: 'Label' },
          {
            key: 'text',
            label: 'Content',
            hint: 'Paste text; for a long document, use s to add its file.',
          },
        ],
        async (values) => {
          await client.post(`${base}/sources`, { kind: 'text', ...values });
          return 'Notes added.';
        },
      );
    if (input === 'u')
      act(async () => {
        for (const source of project.sources.filter((s) => ['local', 'git'].includes(s.kind)))
          await client.post(`${base}/sources/${source.id}/sync`);
        return 'Sources refreshed. Changed evidence invalidates dependent analysis.';
      });
    if (input === 'd')
      show(
        'Remove source',
        [
          {
            key: 'number',
            label: 'Source number',
            hint: 'Source numbers are shown in Scope & source inventory.',
          },
          { key: 'confirm', label: 'Type DELETE' },
        ],
        async ({ number, confirm }) => {
          if (confirm !== 'DELETE') return 'Removal cancelled.';
          const source = project.sources[Number(number) - 1];
          if (!source) throw new Error('Unknown source number.');
          await client.request('DELETE', `${base}/sources/${source.id}`);
          return 'Source removed; dependent analysis cleared.';
        },
      );
    if (input === 'a' && phase)
      show(
        `Approve ${phase.title}`,
        [
          {
            key: 'reviewer',
            label: 'Reviewer',
            hint: 'Confirm that you have checked this artifact.',
          },
          { key: 'notes', label: 'Review notes', optional: true },
        ],
        async (values) => {
          await client.post(`${base}/artifacts/${phase.id}/approve`, {
            revision: project.revision,
            ...values,
          });
          return 'Human review recorded. Press r to continue.';
        },
      );
    if (input === 'e' && phase)
      act(async () => {
        if (phase.id === 'scope') {
          const data = await editor(
            { name: project.name, scope: project.scope, config: project.config },
            suspendTerminal,
          );
          await client.request('PATCH', base, { ...data, revision: project.revision });
        } else {
          if (!project.artifacts[phase.id])
            throw new Error('Generate this artifact before editing.');
          const data = await editor(project.artifacts[phase.id].data, suspendTerminal);
          await client.request('PUT', `${base}/artifacts/${phase.id}`, {
            data,
            revision: project.revision,
          });
        }
        return 'Edit saved. Dependent artifacts need regeneration.';
      });
    if (input === 'p')
      show(
        'Provider & models',
        [
          {
            key: 'provider',
            label: 'Provider',
            value: project.config.provider,
            hint: 'openai or anthropic. API keys are loaded by the server.',
          },
        ],
        async ({ provider }) => {
          if (!providers[provider]) throw new Error('Choose openai or anthropic.');
          const { fastModel, deepModel } = providers[provider];
          await client.request('PATCH', base, {
            revision: project.revision,
            config: { ...project.config, provider, fastModel, deepModel },
          });
          return `Provider set to ${provider}. Edit scope/settings (e) to customize models and phases.`;
        },
      );
    if (input === 'v')
      act(async () => {
        await client.post(`/v1/providers/${project.config.provider}/test`, {
          model: project.config.fastModel,
        });
        return 'Provider connection verified.';
      });
    if (input === 'x')
      show(
        'Export',
        [
          { key: 'format', label: 'Format', value: 'markdown', hint: 'markdown, pdf or json' },
          {
            key: 'file',
            label: 'Output path',
            optional: true,
            hint: 'Leave empty for a new file in the current directory.',
          },
        ],
        async ({ format, file }) => {
          if (!['markdown', 'pdf', 'json'].includes(format))
            throw new Error('Choose markdown, pdf or json.');
          const data =
            format === 'json'
              ? JSON.stringify(await client.get(`${base}/export`), null, 2)
              : await client.get(`${base}/report?format=${format}`, {
                  format: format === 'pdf' ? 'buffer' : 'text',
                });
          const destination = file
            ? path.resolve(file)
            : path.join(
                exportDir,
                `aitm-${project.id}-${Date.now()}.${format === 'markdown' ? 'md' : format}`,
              );
          await writeFile(destination, data, { mode: 0o600, flag: 'wx' });
          return `Exported to ${destination}`;
        },
      );
  });
  const height = Math.max(4, rows - 16),
    narrow = columns < 95,
    panelWidth = Math.max(25, columns - (narrow ? 6 : 38));
  const latest = project?.runs.at(-1);
  const detailText =
    detail === 'log'
      ? latest
        ? [
            `RUN ${latest.id}`,
            `Status: ${latest.status}`,
            `Tokens: ${latest.usage.inputTokens} input / ${latest.usage.outputTokens} output`,
            latest.error || '',
            ...latest.events.map(
              (e) => `${e.at.slice(11, 19)} ${e.phase || ''} ${e.type}: ${e.message}`,
            ),
          ].join('\n')
        : 'No runs yet.'
      : detail === 'help'
        ? 'r Run/resume with human review gates\nf Run/resume a full draft (unreviewed)\nF Restart draft, clearing generated analysis\ng Regenerate selected phase\na Approve selected artifact\ne Edit artifact or scope/settings in your editor\ns Add local file/folder or HTTPS Git repository\nt Add text notes\nu Refresh local/Git sources\nd Remove a numbered source\np Select provider and default models\nv Verify provider connection\nc Cancel active run\nx Export Markdown, PDF or JSON\nl Toggle run log and errors\nj/k or Page Down/Up: scroll\nEsc Return to assessment list\nq Quit TUI (server continues)\n\nSource excerpts go to the selected provider when you run.\nDraft output needs expert review.\nSettings: select Scope then e to edit optional phases,\nmodel IDs, scope and effort.\nPhase markers: + approved, * draft, - pending.'
        : project && phase
          ? artifactText(phase.id, project)
          : '';
  const content = label(detailText)
    .split('\n')
    .flatMap((line) => {
      if (!line) return [''];
      const chunks = [];
      let rest = line;
      while (rest.length > panelWidth) {
        const space = rest.lastIndexOf(' ', panelWidth);
        const end = space > 0 ? space : panelWidth;
        chunks.push(rest.slice(0, end));
        rest = rest.slice(end).trimStart();
      }
      chunks.push(rest);
      return chunks;
    });
  const safeOffset = Math.min(offset, Math.max(0, content.length - height));
  const header = h(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: GOLD }, columns >= 60 ? LOGO : 'AITM  o--o--o'),
    h(Text, { color: MAGENTA }, TAGLINE),
    h(Text, { dimColor: true }, `Engine ${client.url}`),
  );
  let body;
  if (form) body = h(Form, { key: form.title, ...form, onCancel: () => setForm(null) });
  else if (!project)
    body = h(
      Box,
      { flexDirection: 'column', minHeight: height },
      h(Text, { bold: true }, 'Assessments'),
      ...projects
        .slice(Math.max(0, selected - height + 2), Math.max(height - 1, selected + 1))
        .map((p, i) =>
          h(
            Text,
            { key: p.id, color: p.id === projects[selected]?.id ? GOLD : undefined },
            `${p.id === projects[selected]?.id ? '>' : ' '} ${label(p.name)}  [${p.lastRun || 'saved'}]`,
          ),
        ),
      !projects.length
        ? h(Text, { dimColor: true }, 'No assessments yet. Press n to create one.')
        : null,
      h(Text, { dimColor: true }, '\nn New   Enter Open   i Import   q Quit'),
    );
  else
    body = h(
      Box,
      { flexDirection: narrow ? 'column' : 'row', minHeight: height },
      h(
        Box,
        { flexDirection: 'column', width: narrow ? undefined : 30, marginRight: 2 },
        h(Text, { bold: true, color: GOLD }, label(project.name)),
        h(
          Text,
          { dimColor: true },
          `${project.config.provider} · ${providers[project.config.provider]?.configured ? 'key configured' : 'key missing'}`,
        ),
        ...(narrow
          ? [
              h(
                Text,
                { key: 'current', color: MAGENTA, wrap: 'truncate-end' },
                `${meta?.phases.findIndex((p) => p.id === phase?.id)}. ${phase?.title || ''}  [up/down]`,
              ),
            ]
          : phases.map((p) =>
              h(
                Text,
                { key: p.id, color: p.id === phase?.id ? GOLD : undefined, wrap: 'truncate-end' },
                `${p.id === phase?.id ? '>' : ' '} ${project.artifacts[p.id]?.status === 'approved' ? '+' : project.artifacts[p.id] ? '*' : '-'} ${meta.phases.findIndex((x) => x.id === p.id)}. ${p.title}`,
              ),
            )),
      ),
      h(
        Box,
        { flexDirection: 'column', flexGrow: 1 },
        h(
          Text,
          { color: MAGENTA, bold: true, wrap: 'truncate-end' },
          `${detail === 'artifact' ? phase?.title || '' : detail === 'log' ? 'Run log' : 'Keyboard help'}  ${safeOffset + 1}/${content.length}`,
        ),
        h(
          Text,
          null,
          content
            .slice(safeOffset, safeOffset + (narrow ? Math.max(3, height - 3) : height))
            .join('\n'),
        ),
      ),
    );
  const last = project?.runs.at(-1);
  return h(
    Box,
    { flexDirection: 'column', paddingX: 1 },
    header,
    body,
    h(
      Box,
      { flexDirection: 'column', marginTop: 1 },
      h(
        Text,
        { color: live ? GOLD : last?.status === 'failed' ? 'red' : MAGENTA, wrap: 'truncate-end' },
        busy
          ? 'Working…'
          : live
            ? `[${progress?.phase || live.phase || 'queued'}] ${progress?.message || 'Running'} ${progress?.characters ? `· ${progress.characters} characters` : ''}`
            : last
              ? `${last.status.toUpperCase()}${last.phase ? ` · ${last.phase}` : ''}${last.error ? ` · ${last.error}` : ''}`
              : '',
      ),
      h(
        Text,
        {
          color: notice.includes('failed') || notice.includes('Cannot') ? 'red' : undefined,
          wrap: 'truncate-end',
        },
        label(notice),
      ),
      project && !form
        ? h(
            Text,
            { dimColor: true },
            'r Review run  f Full draft  a Approve  e Edit  s Source  p Provider\nc Cancel  x Export  l Log  ? Help  j/k Scroll  Esc Projects  q Quit',
          )
        : null,
    ),
  );
}
