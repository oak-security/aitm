import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import TextInput from 'ink-text-input';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { LOGO, TAGLINE, terminalText } from './logo.js';
import { editJSON } from './editor.js';
import { RunProgress } from './progress.js';
import { ReportReader } from './report-reader.js';
import { Select } from './select.js';
import { enabledPhases } from '../engine/schema.js';
import { markdownReport, pdfReport } from '../engine/report.js';

const h = React.createElement;
const GOLD = '#FFC965',
  MAGENTA = '#D85CB4';
const running = (p) => p?.runs.findLast((r) => ['running', 'queued'].includes(r.status));
const label = (value) => terminalText(value);

export function Form({ title, fields, onSubmit, onCancel, disabled = false }) {
  const [index, setIndex] = useState(0),
    [values, setValues] = useState({}),
    [value, setValue] = useState(fields[0].value || '');
  useInput(
    (input, key) => {
      if (key.escape) onCancel();
    },
    { isActive: !disabled },
  );
  const field = fields[index];
  return h(
    Box,
    { flexDirection: 'column', borderStyle: 'round', borderColor: GOLD, paddingX: 2, paddingY: 1 },
    h(Text, { bold: true, color: GOLD }, terminalText(title)),
    h(
      Text,
      { dimColor: true },
      terminalText(
        `${index + 1}/${fields.length}  ${field.hint || 'Enter to continue. Escape to cancel.'}`,
      ),
    ),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: MAGENTA }, `${field.label}: `),
      h(TextInput, {
        value,
        focus: !disabled,
        mask: field.secret ? '*' : undefined,
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
        `${i + 1}. ${s.label} [${s.kind}] — ${s.files.length} file${s.files.length === 1 ? '' : 's'}`,
        `   ${s.locator || 'Synced snapshot'}${s.commit ? ` @ ${s.commit.slice(0, 12)}` : ''}`,
        ...s.warnings.map((w) => `   Warning: ${w}`),
      ]),
      '',
      'i Add sources   b Manage sources   u Refresh snapshots   e Edit scope/settings',
      'o Projects   n New project',
    ].join('\n');
  const a = project.artifacts[phase];
  const run = project.runs.at(-1);
  if (!a && run?.phase === phase && run.status === 'running')
    return 'This TRACE step is running. Its result will appear here automatically.\n\nEarlier steps are saved. You can inspect them with Up/Down while the engine continues.';
  if (!a && run?.phase === phase && run.status === 'failed')
    return 'This step has not finished yet. Earlier steps are saved.\n\nf Continue TRACE from here\nl Show technical details';
  if (!a)
    return 'No artifact yet.\n\nf  Run full pipeline: TRACE, STRIDE, top 3 attack trees and report\nr  Run / resume with review gates\n\nSource content is sent to your selected AI provider.';
  if (phase === 'report')
    return 'Report ready.\n\nv View the complete Markdown report\nx Export Markdown, PDF or JSON\n\nThe report opens only when you choose to view it.';
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
  const note = a.reviewNotes?.length
    ? `\nSource review: ${a.reviewNotes.length} unverified claim(s) are flagged below. TRACE can continue.\n`
    : '';
  return `${a.status.toUpperCase()}${a.review ? (a.review.reviewer ? ` — ${a.review.reviewer}` : ' — reviewed') : ' — awaiting expert review'}\n${note}\n${pretty(a.data)}`;
}

export function App({
  engine,
  projectId,
  apiUrl,
  initialNotice = 'Ready. f Run full pipeline · ? Help.',
  editor = editJSON,
  exportDir = process.cwd(),
  onProjects,
  onNewProject,
  onAddSources,
  onSources,
}) {
  const { exit, suspendTerminal } = useApp();
  const { columns = 100, rows = 30 } = useWindowSize();
  const [project, setProject] = useState(() => engine.get(projectId));
  const providers = engine.providers.status();
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [offset, setOffset] = useState(0),
    [form, setForm] = useState(null),
    [notice, setNotice] = useState(initialNotice),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState('artifact');
  const mounted = useRef(true),
    providerCheck = useRef(null);
  const refresh = useCallback(() => {
    if (!mounted.current) return;
    try {
      setProject(engine.get(projectId));
    } catch (error) {
      setProject(null);
      setNotice(error.message);
    }
  }, [engine, projectId]);
  useEffect(() => {
    mounted.current = true;
    const changed = (id) => {
      if (id === projectId) refresh();
    };
    engine.events.on('change', changed);
    refresh();
    return () => {
      mounted.current = false;
      providerCheck.current?.abort();
      engine.events.off('change', changed);
    };
  }, [engine, projectId, refresh]);
  const live = running(project);
  const phases = project ? enabledPhases(project) : [];
  const phase = phases[Math.min(phaseIndex, phases.length - 1)];
  const hasReport = Boolean(project?.artifacts.report);
  const viewingReport = reportOpen && hasReport && phase?.id === 'report' && detail === 'artifact';
  const lastRun = project?.runs.at(-1);
  const following =
    live?.phase || (['failed', 'awaiting_review'].includes(lastRun?.status) ? lastRun.phase : null);
  const phaseOrder = phases.map((phase) => phase.id).join(',');
  useEffect(() => {
    const index = phaseOrder.split(',').indexOf(following);
    if (index < 0) return;
    setPhaseIndex(index);
    setOffset(0);
    setDetail('artifact');
  }, [projectId, lastRun?.id, following, phaseOrder]);
  const act = async (action, label = 'Saving changes') => {
    if (busy) return;
    setBusy({ label, since: Date.now() });
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
  const show = (title, fields, submit, activity = 'Saving changes') => {
    setForm({ title, fields, onSubmit: (values) => act(() => submit(values), activity) });
  };
  const choose = (title, options, onSelect, extra = {}) => {
    if (mounted.current) setForm({ title, options, onSelect, ...extra });
  };
  const providerOptions = () =>
    Object.entries(engine.providers.status()).map(([value, status]) => ({
      value,
      label: `${value === 'openai' ? 'OpenAI' : 'Anthropic'} · ${status.configured ? 'key configured' : 'key missing'} · ${status.keySource}`,
    }));
  const configureProvider = () =>
    choose(
      'Provider & models · 1/3',
      providerOptions(),
      (provider) => {
        act(async () => {
          const controller = new AbortController();
          providerCheck.current = controller;
          let catalog;
          try {
            catalog = await engine.providers.models(provider, controller.signal);
          } finally {
            providerCheck.current = null;
          }
          const current =
            project.config.provider === provider ? project.config : providers[provider];
          const ids = [
            ...new Set([current.fastModel, current.deepModel, ...catalog.models.map((m) => m.id)]),
          ];
          const options = ids.map((id) => ({
            value: id,
            label: `${id}${id === providers[provider].fastModel ? ' · fast default' : id === providers[provider].deepModel ? ' · deep default' : ''}${catalog.source === 'account' && !catalog.models.some((m) => m.id === id) ? ' · saved, unavailable in account list' : ''}`,
          }));
          choose(
            'Fast model · 2/3',
            options,
            (fastModel) => {
              choose(
                'Deep model · 3/3',
                options,
                (deepModel) => {
                  act(async () => {
                    engine.update(project.id, {
                      revision: project.revision,
                      config: { ...project.config, provider, fastModel, deepModel },
                    });
                    return `${provider} models saved. Fast: ${fastModel} · Deep: ${deepModel}`;
                  });
                },
                {
                  value: current.deepModel,
                  hint: 'STRIDE & coordination. Changing models clears generated analysis.',
                },
              );
            },
            {
              value: current.fastModel,
              hint: 'Used for intake, TRACE model, attack trees and report.',
            },
          );
          return catalog.notice || 'Account models loaded. Choose a fast model, then a deep model.';
        }, 'Loading provider models');
      },
      { value: project.config.provider },
    );
  const configureKey = (provider) => {
    const name = provider === 'openai' ? 'OpenAI' : 'Anthropic';
    show(
      `${name} API key`,
      [
        {
          key: 'key',
          label: 'API key',
          secret: true,
          optional: true,
          hint: 'Paste a new key. Enter keeps the existing key; Esc cancels.',
        },
        ...(provider === 'anthropic'
          ? [
              {
                key: 'workspace',
                label: 'Workspace ID',
                optional: true,
                value: engine.providers.anthropicWorkspaceId,
                hint: 'Optional wrkspc_ ID for multi-workspace keys. Empty clears it.',
              },
            ]
          : []),
      ],
      async (values) => {
        const patch = {
          ...(values.key.trim() ? { [provider]: values.key } : {}),
          ...(values.workspace !== undefined &&
          values.workspace !== engine.providers.anthropicWorkspaceId
            ? { anthropicWorkspaceId: values.workspace }
            : {}),
        };
        if (!Object.keys(patch).length) return 'No credentials changed.';
        engine.providers.configure(patch);
        return `${name} credentials ${engine.providers.saveCredentials ? 'saved privately' : 'updated for this session'} and active now. V verifies the connection.`;
      },
    );
  };
  const settings = () =>
    choose(
      'Settings',
      [
        { value: 'keys', label: 'API keys · add or replace' },
        { value: 'models', label: 'Provider & models' },
        { value: 'back', label: 'Back to assessment' },
      ],
      (value) => {
        if (value === 'keys')
          choose('API keys · choose provider', providerOptions(), configureKey, {
            value: project.config.provider,
            hint: engine.providers.keyFile
              ? `Saved privately: ${engine.providers.keyFile}`
              : 'Keys apply to this session.',
          });
        else if (value === 'models') configureProvider();
        else setForm(null);
      },
    );
  const run = (mode, resume = true, selectedPhase = undefined) =>
    act(async () => {
      engine.run(project.id, {
        mode,
        resume,
        ...(selectedPhase ? { phase: selectedPhase } : {}),
      });
      setDetail('artifact');
      return `${mode === 'full' ? 'Full pipeline' : mode === 'draft' ? 'Draft' : 'Review'} started. Results remain drafts until reviewed.`;
    }, 'Starting pipeline');
  useInput((input, key) => {
    if (form) return;
    if (input === 'q') {
      exit();
      return;
    }
    if (busy) return;
    if (input === 'o') return onProjects?.();
    if (input === 'n') return onNewProject?.();
    if (input === 'i') return onAddSources?.();
    if (input === 'b') return onSources?.();
    if (!project) return;
    if (input === 'v') {
      if (!hasReport) {
        setNotice('The report is not ready yet. Press f to run the full pipeline.');
        return;
      }
      setPhaseIndex(phases.findIndex((p) => p.id === 'report'));
      setReportOpen(true);
      setDetail('artifact');
      setOffset(0);
      return;
    }
    if (key.escape) {
      if (reportOpen) {
        setReportOpen(false);
        setPhaseIndex(0);
      }
      setDetail('artifact');
      setOffset(0);
    }
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
    if (!viewingReport) {
      if (key.pageDown || input === 'j') setOffset((i) => i + Math.max(1, rows - 16));
      if (key.pageUp || input === 'k') setOffset((i) => Math.max(0, i - Math.max(1, rows - 16)));
    }
    if (input === 'r') run('review');
    if (input === 'f') run('full');
    if (input === 'g' && phase?.id !== 'scope') run('review', true, phase.id);
    if (input === 'F')
      show(
        'Restart full pipeline',
        [
          {
            key: 'confirm',
            label: 'Type RESTART',
            hint: 'This clears generated analysis and reviews; source evidence and scope are kept.',
          },
        ],
        async ({ confirm }) => {
          if (confirm !== 'RESTART') return 'Restart cancelled.';
          engine.run(project.id, { mode: 'full', resume: false });
          return 'Full pipeline restarted; results remain drafts.';
        },
      );
    if (input === 'c' && live)
      act(async () => {
        await engine.cancel(project.id, live.id);
        return 'Run cancelled; completed artifacts are saved.';
      });
    if (input === 'u')
      act(async () => {
        for (const source of project.sources.filter((s) =>
          ['local', 'git', 'url'].includes(s.kind),
        ))
          await engine.syncSource(project.id, source.id);
        return 'Sources refreshed. Changed evidence invalidates dependent analysis.';
      }, 'Refreshing source snapshots');
    if (input === 'a' && phase)
      show(
        `Approve ${phase.title}`,
        [
          {
            key: 'notes',
            label: 'Review notes (optional)',
            optional: true,
            hint: 'Enter approves this step. Escape cancels. No reviewer name is required.',
          },
        ],
        async (values) => {
          engine.approve(project.id, phase.id, {
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
          engine.update(project.id, { ...data, revision: project.revision });
        } else {
          if (!project.artifacts[phase.id])
            throw new Error('Generate this artifact before editing.');
          const data = await editor(project.artifacts[phase.id].data, suspendTerminal);
          engine.editArtifact(project.id, phase.id, {
            data,
            revision: project.revision,
          });
        }
        return 'Edit saved. Dependent artifacts need regeneration.';
      });
    if (input === 'p') configureProvider();
    if (input === 's') settings();
    if (input === 'V')
      act(async () => {
        const controller = new AbortController();
        providerCheck.current = controller;
        try {
          await engine.providers.test(
            project.config.provider,
            project.config.fastModel,
            AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
          );
        } finally {
          providerCheck.current = null;
        }
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
              ? JSON.stringify(engine.export(project.id), null, 2)
              : format === 'pdf'
                ? await pdfReport(project)
                : markdownReport(project);
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
  const latest = project?.runs.at(-1);
  const compactHeader = rows < 22 || columns < 45;
  const logoBesideInfo = columns >= 70;
  const headerHeight = compactHeader ? 2 : logoBesideInfo ? 6 : 7;
  const actionHeight = project && !form ? (viewingReport ? 3 : 4) : 0;
  const activityHeight = busy ? 2 : form ? 0 : live ? 5 : latest && !viewingReport ? 3 : 0;
  // Reserve the cursor row as well as the footer. Never let report content grow
  // the terminal viewport: Ink's next diff must still be able to reach the menu.
  const height = Math.max(3, rows - headerHeight - actionHeight - activityHeight - 3),
    narrow = columns < 95,
    panelWidth = Math.max(25, columns - (narrow ? 6 : 38));
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
        ? `Saved assessments: ${engine.store.directory}\nMarkdown is assembled from the saved assessment.\nExports go to the path selected with x.\n\n` +
          'o Open/manage projects\nn New project\ni Add sources (URLs, documents, ZIP repositories)\nb Manage source snapshots\nr Run/resume with human review gates\nf Run full pipeline: top 3 STRIDE attack trees, no review stops\nF Restart full pipeline, clearing generated analysis\ng Regenerate selected phase\na Approve selected artifact\ne Edit artifact or scope/settings in your editor\nu Refresh source snapshot\ns Settings: add or replace API keys\np Pick provider, fast model and deep model from lists\nv View the Markdown report (no export)\nV Verify provider connection\nc Cancel active run\nx Export Markdown, PDF or JSON to a chosen file\nl Toggle run log and errors\nj/k or Page Down/Up: scroll\nReport: [ / ] previous/next section; Home/End first/last page\nEsc Return to artifact\nq Save and quit (unfinished step is cancelled)\n\nSource content goes to the selected provider when you run.\nDraft output needs expert review.\nSettings: select Scope then e to edit optional phases,\nscope and effort. Use p for model lists.\nPhase markers: + approved, * draft, - pending.'
        : !viewingReport && project && phase
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
  const header = compactHeader
    ? h(
        Box,
        { marginBottom: 1, flexShrink: 0 },
        h(Text, { color: GOLD, bold: true, wrap: 'truncate-end' }, 'AiTM  o--o  / TRACE  / q Quit'),
      )
    : h(
        Box,
        { flexDirection: logoBesideInfo ? 'row' : 'column', marginBottom: 1, flexShrink: 0 },
        h(Box, { flexShrink: 0, width: 37 }, h(Text, { color: GOLD }, LOGO)),
        h(
          Box,
          { flexDirection: 'column', marginLeft: logoBesideInfo ? 3 : 0, flexShrink: 1 },
          logoBesideInfo ? h(Text, { color: MAGENTA }, TAGLINE) : null,
          logoBesideInfo && project
            ? h(Text, { bold: true, wrap: 'truncate-end' }, label(project.name))
            : null,
          h(
            Text,
            { dimColor: true, wrap: 'truncate-end' },
            apiUrl ? `API ${apiUrl}` : 'TRACE engine',
          ),
          logoBesideInfo ? h(Text, { dimColor: true }, 'q Save & quit') : null,
        ),
      );
  let body;
  if (form)
    body = h(form.options ? Select : Form, {
      key: form.title,
      ...form,
      onCancel: () => setForm(null),
    });
  else if (!project) body = h(Text, null, 'This assessment was removed. Quit and reopen a source.');
  else if (viewingReport)
    body = h(ReportReader, {
      project,
      width: Math.max(20, columns - 2),
      height,
      reviewCount: phases.reduce(
        (sum, phase) => sum + (project.artifacts[phase.id]?.reviewNotes?.length || 0),
        0,
      ),
    });
  else
    body = h(
      Box,
      { flexDirection: narrow ? 'column' : 'row', height, flexShrink: 0, overflow: 'hidden' },
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
                `${phases.indexOf(phase) + 1}. ${phase?.title || ''}  [up/down]`,
              ),
            ]
          : phases
              .slice(
                Math.max(0, phaseIndex - Math.max(1, height - 4)),
                Math.max(height - 2, phaseIndex + 1),
              )
              .map((p) =>
                h(
                  Text,
                  { key: p.id, color: p.id === phase?.id ? GOLD : undefined, wrap: 'truncate-end' },
                  `${p.id === phase?.id ? '>' : ' '} ${project.artifacts[p.id]?.status === 'approved' ? '+' : project.artifacts[p.id] ? '*' : '-'} ${phases.indexOf(p) + 1}. ${p.title}`,
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
            .slice(safeOffset, safeOffset + (narrow ? Math.max(1, height - 4) : height - 1))
            .join('\n'),
        ),
      ),
    );
  return h(
    Box,
    { flexDirection: 'column', paddingX: 1, height: Math.max(1, rows - 1), overflow: 'hidden' },
    header,
    project && !form
      ? h(
          Box,
          { flexDirection: 'column', marginBottom: 1, flexShrink: 0 },
          h(
            Text,
            { color: GOLD, bold: true, wrap: 'truncate-end' },
            hasReport
              ? 'f Run full pipeline   v View Markdown   x Export   s Settings'
              : 'f Run full pipeline (top 3 attack trees)   v View Markdown',
          ),
          h(
            Text,
            { color: GOLD, wrap: 'truncate-end' },
            'o Projects   n New project   i Add sources   b Manage sources',
          ),
          !viewingReport
            ? h(
                Text,
                { dimColor: true },
                's Settings  p Models  r Review  a Approve  e Edit  x Export  ? Help',
              )
            : null,
        )
      : null,
    activityHeight
      ? h(
          Box,
          { flexDirection: 'column', marginBottom: 1, flexShrink: 0 },
          h(RunProgress, {
            project,
            phases,
            busy,
            controls: !form,
          }),
        )
      : null,
    body,
    h(
      Box,
      { flexDirection: 'column', marginTop: 1, flexShrink: 0 },
      h(
        Text,
        {
          color: notice.includes('failed') || notice.includes('Cannot') ? 'red' : undefined,
          wrap: 'truncate-end',
        },
        label(notice),
      ),
    ),
  );
}
