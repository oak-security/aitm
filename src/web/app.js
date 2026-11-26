import { esc, pretty, human, button, field, select, options } from './html.js';
import { activeRun, sidebar, topbar, progress, view, sourceForm } from './views.js';

const $ = (selector) => document.querySelector(selector);
const state = {
  projects: [],
  project: null,
  phases: [],
  providers: {},
  catalogs: {},
  view: 'overview',
  health: {},
  meta: { phases: [] },
  dirty: false,
  report: null,
  busy: '',
  event: null,
};
let refreshNumber = 0,
  routeNumber = 0,
  stream,
  streamId,
  changeTimer,
  toastTimer,
  onDialogSubmit,
  dialogReturnFocus;
const terminalEvents = ['completed', 'failed', 'cancelled', 'interrupted', 'awaiting_review'];

async function api(path, method = 'GET', body) {
  const response = await fetch(`/v1${path}`, {
    method,
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401)
      throw new Error(
        'This browser session has no valid access token. Open the complete URL that AiTM printed in its terminal.',
      );
    throw new Error(data.error?.message || `Request failed (${response.status}).`);
  }
  return response.headers.get('content-type')?.includes('application/json')
    ? response.json()
    : response.text();
}
function error(message) {
  const box = $('#dialog').open ? $('#dialog-error') : $('#error');
  box.hidden = !message;
  box.textContent = message || '';
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('#toast').hidden = true;
  }, 4500);
}
function chrome() {
  const menuOpen = $('#sidebar').classList.contains('open');
  $('#sidebar').innerHTML = sidebar(state);
  $('#topbar').innerHTML = topbar(state);
  $('#topbar [data-action="menu"]').setAttribute('aria-expanded', String(menuOpen));
  $('#activity').innerHTML = progress(state);
}
function render() {
  const y = $('#workspace').scrollTop;
  chrome();
  if (!state.dirty) {
    $('#workspace').innerHTML = `<div class="view">${view(state)}</div>`;
    state.routeNeedsRender = false;
    $('#workspace').scrollTop = y;
  }
}
function projectPath(suffix = '') {
  if (!state.project) throw new Error('Open an assessment first.');
  return `/projects/${state.project.id}${suffix}`;
}
async function refresh(force = false) {
  const id = state.routeId,
    turn = ++refreshNumber;
  const [projects, providers, project, phases] = await Promise.all([
    api('/projects'),
    api('/providers'),
    id
      ? api(`/projects/${id}`).catch((e) => {
          if (e.message.includes('not found')) return null;
          throw e;
        })
      : null,
    id ? api(`/projects/${id}/phases`).catch(() => []) : [],
  ]);
  if (turn !== refreshNumber || state.routeId !== id) return;
  const changed =
    force ||
    state.routeNeedsRender ||
    state.project?.revision !== project?.revision ||
    JSON.stringify(state.projects) !== JSON.stringify(projects);
  const reportKey = project?.artifacts.report?.generatedAt;
  if (state.project?.id !== project?.id || state.reportKey !== reportKey) state.report = null;
  Object.assign(state, { projects, providers, project, phases, reportKey });
  connectRun();
  if (changed) render();
  else chrome();
  if (state.view === 'report' && project?.artifacts.report && state.report == null) {
    const text = await api(`/projects/${id}/report`);
    if (state.routeId === id && state.reportKey === reportKey) {
      state.report = text;
      if (state.view === 'report') render();
    }
  }
  if (state.view === 'settings')
    await loadModels(state.settingsProvider || project?.config.provider || 'openai');
}
function queueRefresh() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => refresh().catch((e) => error(e.message)), 100);
}
function connectRun() {
  const run = activeRun(state.project);
  if (run?.id === streamId) return;
  stream?.close();
  stream = null;
  streamId = run?.id;
  state.event = run?.events.at(-1) || null;
  state.request = run?.events.findLast((e) => e.type === 'request') || null;
  if (!run) return;
  stream = new EventSource(
    `/v1/projects/${state.project.id}/runs/${run.id}/events?after=${run.lastEventId}`,
  );
  for (const type of [
    'running',
    'request',
    'progress',
    'validating',
    'validation_retry',
    'repair_fallback',
    'evidence_review',
    'reference_review',
    'source_refresh',
    'artifact',
    'reused',
    'skipped',
    'review_notes',
    'batch_complete',
    ...terminalEvents,
  ]) {
    stream.addEventListener(type, (message) => {
      if (streamId !== run.id) return;
      state.event = JSON.parse(message.data);
      if (type === 'request') state.request = state.event;
      $('#activity').innerHTML = progress(state);
      if (terminalEvents.includes(type)) {
        stream?.close();
        stream = null;
        streamId = null;
        toast(['completed', 'awaiting_review'].includes(type) ? state.event.message : human(type));
        queueRefresh();
      } else if (['artifact', 'source_refresh', 'running'].includes(type)) queueRefresh();
    });
  }
  stream.onerror = () => {
    $('#activity').innerHTML =
      '<span class="spinner"></span>Reconnecting to the engine… Saved progress will be restored.';
    queueRefresh();
  };
}
async function route() {
  const turn = ++routeNumber;
  const parts = location.hash.slice(1).split('/').filter(Boolean);
  const id = parts[0] === 'projects' && /^[\da-f-]{36}$/i.test(parts[1] || '') ? parts[1] : null;
  state.view = id ? parts[2] || 'overview' : parts[0] === 'settings' ? 'settings' : 'overview';
  if (state.routeId !== id) {
    state.project = null;
    state.report = null;
    state.settingsProvider = null;
  }
  state.routeId = id;
  state.dirty = false;
  state.rawReport = false;
  $('#sidebar').classList.remove('open');
  closeDialog();
  error('');
  $('#workspace').innerHTML = '<div class="loading">Opening assessment…</div>';
  state.routeNeedsRender = true;
  $('#workspace').scrollTop = 0;
  await refresh(true);
  if (turn === routeNumber) {
    document.title = `${state.project?.name || 'AiTM'} · ${human(state.view)} · AiTM`;
    $('#workspace').focus({ preventScroll: true });
  }
}
function navigate(id, selectedView = 'overview') {
  location.hash = id ? `/projects/${id}/${selectedView}` : '/';
}
function dialog(title, content, submit) {
  if (!$('#dialog').open) dialogReturnFocus = document.activeElement;
  $('#dialog').innerHTML =
    `<div class="dialog-heading"><h2 id="dialog-title">${esc(title)}</h2>${button('close-dialog', '×', 'aria-label="Close dialog"', 'icon')}</div><div id="dialog-error" class="notice warn" role="alert" hidden></div>${content}`;
  onDialogSubmit = submit;
  if (!$('#dialog').open) $('#dialog').showModal();
  $('#dialog').querySelector('input,textarea,select')?.focus();
}
function closeDialog() {
  if (!$('#dialog').open) return;
  $('#dialog').close();
  $('#dialog').innerHTML = '';
  onDialogSubmit = null;
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus();
}
function confirm(title, message, label, action) {
  dialog(
    title,
    `<form data-form="dialog"><p>${esc(message)}</p><div class="row">${button('close-dialog', 'Cancel')}<button class="btn danger">${esc(label)}</button></div></form>`,
    action,
  );
}
async function act(label, task, { close = true, preserveForm = false } = {}) {
  if (state.busy) return;
  state.busy = label;
  error('');
  chrome();
  const buttons = [...document.querySelectorAll('main button, dialog button')].filter(
    (b) => !b.disabled,
  );
  buttons.forEach((b) => {
    b.disabled = true;
  });
  try {
    await task();
    if (!preserveForm) state.dirty = false;
    if (close) closeDialog();
    await refresh(true);
  } catch (e) {
    error(e.message);
  } finally {
    state.busy = '';
    buttons.forEach((b) => {
      if (b.isConnected) b.disabled = false;
    });
    chrome();
  }
}
async function startRun(input) {
  await act('Starting TRACE…', async () => {
    await api(projectPath('/runs'), 'POST', input);
    toast(input.mode === 'review' ? 'Review flow started.' : 'Full pipeline started.');
  });
}
async function loadModels(provider, force = false) {
  if (state.catalogs[provider] && !force) return;
  const catalog = await api(`/providers/${provider}/models`);
  state.catalogs[provider] = catalog;
  // Updating options in place preserves unsaved keys and phase preferences.
  const form = document.querySelector(`form[data-form="models"][data-provider="${provider}"]`);
  if (!form) return;
  for (const key of ['fastModel', 'deepModel']) {
    const el = form.elements[key],
      current = el.value;
    const choices = catalog.models.some((m) => m.id === current)
      ? catalog.models
      : [{ id: current }, ...catalog.models];
    el.innerHTML = options(choices, current);
  }
  $('#catalog-notice').textContent = catalog.notice || 'Compatible account models.';
}
async function upload(files) {
  if (!files.length) throw new Error('Choose at least one file.');
  if (files.length > 1000) throw new Error('Choose at most 1,000 files.');
  if (files.reduce((sum, file) => sum + file.size, 0) > 11 * 1024 * 1024)
    throw new Error('This upload exceeds 11 MiB. Use a local folder path for larger sources.');
  const encoded = [];
  for (const file of files) {
    if (file.size > 8 * 1024 * 1024) throw new Error('Each source file must be at most 8 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    encoded.push({
      path: file.webkitRelativePath || file.name,
      content: btoa(binary),
      encoding: 'base64',
    });
  }
  return encoded.map((file) => ({ kind: 'files', label: file.path, files: [file] }));
}
function newProject() {
  dialog(
    'New project',
    `<form data-form="new-project">${field('name', 'Project name', '', { required: true })}${field('scope', 'Scope (optional)', '', { area: true })}<p class="hint">Create the project first, then add any number of source documents, URLs or ZIP repositories.</p><div class="row"><button class="btn primary">Create project</button>${button('close-dialog', 'Cancel')}</div></form>`,
  );
}
function openProject() {
  dialog(
    'Open project',
    state.projects.length
      ? `<div class="project-list">${state.projects.map((p) => button('select-project', `${esc(p.name)} <span>${p.sources} source(s) · ${esc(p.lastRun || 'not run')}</span>`, `data-project="${p.id}"`, 'file-row')).join('')}</div>`
      : '<p>No saved projects yet. Create a new project to begin.</p>',
  );
}
function sourceDialog(sourceId = null) {
  state.replacing = sourceId;
  dialog(sourceId ? 'Replace source' : 'Add sources', sourceForm(Boolean(sourceId)));
}
async function importSources(inputs) {
  const autorun = $('#run-after-import')?.checked;
  if (!inputs.length) throw new Error('Choose at least one explicit source.');
  if (state.replacing) {
    if (inputs.length !== 1)
      throw new Error('Choose one replacement. Use Add sources to import several sources.');
    await api(
      projectPath(`/sources/${state.replacing}`),
      'PUT',
      typeof inputs[0] === 'string' ? { source: inputs[0] } : inputs[0],
    );
  } else await api(projectPath('/sources/import'), 'POST', { sources: inputs });
  if (autorun) await api(projectPath('/runs'), 'POST', { mode: 'full' });
  toast(`${inputs.length} source(s) imported.${autorun ? ' Full pipeline started.' : ''}`);
}
function editArtifact(phase, key, index) {
  const baseline = structuredClone(state.project),
    artifact = baseline.artifacts[phase];
  if (!artifact) throw new Error('Generate this step first.');
  const item = key ? artifact.data[key][index] : null;
  const editable = item
    ? Object.entries(item).filter(
        ([name, value]) =>
          name !== 'id' &&
          (['string', 'number', 'boolean'].includes(typeof value) ||
            (Array.isArray(value) && value.every((v) => typeof v === 'string'))),
      )
    : [];
  dialog(
    key ? `Edit ${item.name || item.title || item.id}` : `Edit ${human(phase)} draft`,
    `<form data-form="dialog"><p class="hint">Saving validates this artifact and clears its downstream analysis. Evidence and references must remain valid.</p>${key ? editable.map(([name, value]) => (typeof value === 'boolean' ? select(name, human(name), ['true', 'false'], String(value)) : field(name, human(name), Array.isArray(value) ? value.join('\n') : value, { area: typeof value !== 'number', type: typeof value === 'number' ? 'number' : 'text' }))).join('') : field('json', 'Artifact JSON', pretty(artifact.data), { area: true, code: true, required: true })}<div class="row"><button class="btn primary">Save draft</button>${button('close-dialog', 'Cancel')}</div></form>`,
    async (values) => {
      let updated;
      if (!key) {
        try {
          updated = JSON.parse(values.json);
        } catch {
          throw new Error('Artifact JSON is not valid. Fix the syntax and try again.');
        }
      } else {
        updated = artifact.data;
        for (const [name, original] of editable)
          updated[key][index][name] = Array.isArray(original)
            ? values[name]
                .split('\n')
                .map((v) => v.trim())
                .filter(Boolean)
            : typeof original === 'number'
              ? Number(values[name])
              : typeof original === 'boolean'
                ? values[name] === 'true'
                : values[name];
      }
      await api(`/projects/${baseline.id}/artifacts/${phase}`, 'PUT', {
        revision: baseline.revision,
        data: updated,
      });
      toast('Draft saved. Review its downstream steps.');
    },
  );
}
function evidence(fileId, start = 1, end = start) {
  const file = state.project.sources.flatMap((s) => s.files).find((f) => f.id === fileId);
  if (!file) throw new Error('This evidence file is not in the current source snapshot.');
  const lines = file.text.split('\n');
  const first = Math.max(1, Math.min(start, lines.length)),
    last = Math.min(lines.length, first + 199);
  state.evidence = { fileId, start: first, end };
  dialog(
    file.path,
    `<p class="hint">${esc(fileId)} · Lines ${first}–${last} of ${lines.length.toLocaleString()} · Full accepted source retained.</p><pre class="source-code">${lines
      .slice(first - 1, last)
      .map(
        (line, i) =>
          `<span class="source-line ${first + i <= end ? 'selected' : ''}"><b>${first + i}</b>${esc(line) || ' '}</span>`,
      )
      .join(
        '',
      )}</pre><div class="row">${button('evidence-page', 'Previous 200 lines', `data-start="${Math.max(1, first - 200)}" ${first === 1 ? 'disabled' : ''}`)}${button('evidence-page', 'Next 200 lines', `data-start="${last + 1}" ${last === lines.length ? 'disabled' : ''}`)}</div>`,
  );
}
function importProject() {
  dialog(
    'Import an assessment',
    `<p>Choose an AiTM v2 JSON export. The engine validates it before saving a new assessment.</p><label class="btn primary file-button">Choose project JSON<input type="file" accept=".json,application/json" data-upload="import" aria-label="Choose project JSON"></label>`,
  );
}
const actions = {
  menu: () => {
    const open = $('#sidebar').classList.toggle('open');
    $('#topbar [data-action="menu"]').setAttribute('aria-expanded', String(open));
  },
  'new-project': newProject,
  'open-project': openProject,
  'select-project': (el) => {
    closeDialog();
    navigate(el.dataset.project);
  },
  'add-sources': () => sourceDialog(),
  'replace-source': (el) => sourceDialog(el.dataset.source),
  import: importProject,
  'close-dialog': closeDialog,
  'run-full': () => startRun({ mode: 'full' }),
  'run-review': () => startRun({ mode: 'review' }),
  restart: () =>
    confirm(
      'Restart full pipeline?',
      'Generated analysis and reviews will be cleared and rebuilt using the saved source snapshot. Provider usage will be charged again.',
      'Restart pipeline',
      () => api(projectPath('/runs'), 'POST', { mode: 'full', resume: false }),
    ),
  generate: (el) => {
    const phase = el.dataset.phase;
    const run = () => api(projectPath('/runs'), 'POST', { mode: 'review', phase });
    if (state.project.artifacts[phase])
      confirm(
        `Regenerate ${human(phase)}?`,
        'This clears the current phase and downstream analysis. Earlier review gates must be approved.',
        'Regenerate step',
        run,
      );
    else return act('Starting step…', run);
  },
  'cancel-run': () =>
    act('Cancelling run…', () =>
      api(projectPath(`/runs/${activeRun(state.project).id}/cancel`), 'POST', {}),
    ),
  approve: (el) => {
    const p = state.project,
      phase = el.dataset.phase;
    dialog(
      `Review ${human(phase)}`,
      `<form data-form="dialog"><p>Approve this artifact to continue. Notes are optional; no reviewer name is required.</p>${field('notes', 'Review notes', '', { area: true })}<div class="row"><button class="btn primary">Approve review</button>${button('close-dialog', 'Cancel')}</div></form>`,
      (values) =>
        api(`/projects/${p.id}/artifacts/${phase}/approve`, 'POST', {
          revision: p.revision,
          ...values,
        }),
    );
  },
  'edit-artifact': (el) => editArtifact(el.dataset.phase),
  'edit-item': (el) => editArtifact(el.dataset.phase, el.dataset.key, Number(el.dataset.index)),
  evidence: (el) =>
    evidence(el.dataset.file, Number(el.dataset.line || 1), Number(el.dataset.end || 1)),
  'evidence-page': (el) => evidence(state.evidence.fileId, Number(el.dataset.start), 0),
  sync: (el) =>
    confirm(
      'Refresh source snapshot?',
      'Read the source again and invalidate analysis if its content changed.',
      'Refresh snapshot',
      () => api(projectPath(`/sources/${el.dataset.source}/sync`), 'POST', {}),
    ),
  'remove-source': (el) =>
    confirm(
      'Remove source?',
      'This removes the saved snapshot and clears dependent analysis. The original file or repository is unchanged.',
      'Remove source',
      () => api(projectPath(`/sources/${el.dataset.source}`), 'DELETE'),
    ),
  delete: () => {
    const id = state.project.id;
    confirm(
      'Delete assessment?',
      `Permanently delete “${state.project.name}” and its saved analysis from AiTM.`,
      'Delete assessment',
      async () => {
        await api(`/projects/${id}`, 'DELETE');
        navigate(null);
      },
    );
  },
  'export-project': () => {
    const link = document.createElement('a');
    link.href = `/v1${projectPath('/export')}`;
    link.download = `aitm-${state.project.id}.json`;
    link.click();
  },
  'report-preview': () => {
    state.rawReport = false;
    render();
  },
  'report-raw': () => {
    state.rawReport = true;
    render();
  },
  'refresh-models': (el) =>
    act('Loading account models…', () => loadModels(el.dataset.provider, true), {
      close: false,
      preserveForm: true,
    }),
  'test-provider': (el) =>
    act(
      'Testing provider connection…',
      async () => {
        const model = document.querySelector('[name="fastModel"]').value;
        await api(`/providers/${el.dataset.provider}/test`, 'POST', { model });
        toast('Provider connection verified.');
      },
      { close: false, preserveForm: true },
    ),
};
document.addEventListener('click', (event) => {
  const section = event.target.closest('[data-section]');
  if (section) {
    event.preventDefault();
    document
      .getElementById(section.dataset.section)
      ?.scrollIntoView({ behavior: 'auto', block: 'start' });
    return;
  }
  const anchor = event.target.closest('a[href^="#/"]');
  if (anchor && state.dirty && anchor.hash !== location.hash) {
    event.preventDefault();
    confirm(
      'Discard unsaved changes?',
      'Your unsaved form changes will be lost when you leave this view.',
      'Discard changes',
      () => {
        state.dirty = false;
        location.hash = anchor.hash;
      },
    );
    return;
  }
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  event.preventDefault();
  Promise.resolve()
    .then(() => actions[el.dataset.action]?.(el))
    .catch((e) => error(e.message));
});
document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const submit = onDialogSubmit;
  act(
    'Saving changes…',
    async () => {
      switch (form.dataset.form) {
        case 'dialog':
          await submit(values);
          break;
        case 'new-project': {
          const p = await api('/projects', 'POST', {
            name: values.name.trim(),
            scope: values.scope.trim() || state.meta.defaultScope,
          });
          navigate(p.id, 'scope');
          toast('Project created. Add its sources to begin.');
          break;
        }
        case 'sources':
          await importSources(
            values.locations
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
          );
          break;
        case 'scope':
          await api(projectPath(), 'PATCH', { ...values, revision: Number(form.dataset.revision) });
          toast('Scope saved.');
          break;
        case 'credentials': {
          const patch = {
            ...(values.apiKey.trim() ? { apiKey: values.apiKey } : {}),
            ...(values.workspaceId?.trim() ? { workspaceId: values.workspaceId.trim() } : {}),
          };
          if (!Object.keys(patch).length) throw new Error('Enter a new API key or workspace ID.');
          const statuses = await api(
            `/providers/${form.dataset.provider}/credentials`,
            'PUT',
            patch,
          );
          form.elements.apiKey.value = '';
          form.dataset.dirty = 'false';
          state.dirty = Boolean(document.querySelector('main form[data-dirty="true"]'));
          form.querySelector('.pill').textContent = 'Key configured';
          form.querySelector('[data-key-source]').textContent =
            `Current source: ${statuses[form.dataset.provider].keySource}. A saved replacement takes precedence over environment settings.`;
          delete state.catalogs[form.dataset.provider];
          toast('Private key settings saved.');
          break;
        }
        case 'models':
          await api(projectPath(), 'PATCH', {
            revision: Number(form.dataset.revision),
            config: {
              provider: form.dataset.provider,
              fastModel: values.fastModel,
              deepModel: values.deepModel,
              effort: values.effort,
              trees: values.trees === 'true',
              treeLimit: Number(values.treeLimit),
              coordination: values.coordination,
            },
          });
          toast('Assessment settings saved.');
          break;
      }
    },
    { preserveForm: form.dataset.form === 'credentials' },
  );
});
document.addEventListener('input', (event) => {
  const form = event.target.closest('main form');
  if (form) {
    form.dataset.dirty = 'true';
    state.dirty = true;
  }
  if (event.target.name === 'threat-search') filterThreats();
});
document.addEventListener('change', (event) => {
  const el = event.target;
  if (el.id === 'project-picker') {
    if (state.dirty) {
      const id = el.value;
      el.value = state.project?.id || '';
      confirm(
        'Discard unsaved changes?',
        'Changing assessments will discard the current unsaved form.',
        'Discard changes',
        () => {
          state.dirty = false;
          navigate(id);
        },
      );
    } else navigate(el.value);
  }
  if (el.name === 'settings-provider') {
    const provider = el.value;
    const change = () => {
      state.settingsProvider = provider;
      state.dirty = false;
      render();
      return loadModels(provider);
    };
    if (state.dirty)
      confirm(
        'Change provider?',
        'This resets unsaved settings in this view. Saved settings stay active until you save the new selection.',
        'Change provider',
        change,
      );
    else change().catch((e) => error(e.message));
  }
  if (el.name === 'threat-category') filterThreats();
  if (el.matches('[data-upload]')) {
    const files = [...el.files];
    if (!files.length) return;
    act('Reading source…', async () => {
      if (el.dataset.upload === 'import') {
        if (files[0].size > 16 * 1024 * 1024) throw new Error('Project import exceeds 16 MiB.');
        let snapshot;
        try {
          snapshot = JSON.parse(await files[0].text());
        } catch {
          throw new Error('Choose a valid AiTM project JSON export.');
        }
        const p = await api('/projects/import', 'POST', snapshot);
        navigate(p.id);
        toast('Assessment imported.');
      } else {
        await importSources(await upload(files));
      }
    });
  }
});
function filterThreats() {
  const term = document.querySelector('[name="threat-search"]').value.trim().toLowerCase(),
    category = document.querySelector('[name="threat-category"]').value;
  let visible = 0;
  document.querySelectorAll('[data-threat]').forEach((el) => {
    el.hidden =
      !el.dataset.threat.includes(term) ||
      (category !== 'All categories' && category !== el.dataset.category);
    if (!el.hidden) visible++;
  });
  $('#no-threats').hidden = visible > 0;
}
$('#dialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  if (!state.busy) closeDialog();
});
window.addEventListener('hashchange', () => route().catch((e) => error(e.message)));
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.addEventListener('focus', () => refresh().catch((e) => error(e.message)));
setInterval(() => {
  if (activeRun(state.project) && !state.busy) $('#activity').innerHTML = progress(state);
}, 1000);
try {
  [state.health, state.meta] = await Promise.all([api('/instance'), api('/meta')]);
  // First run: analysis cannot start without a provider key, so begin in Settings.
  if (
    !location.hash.slice(1).replace('/', '') &&
    !Object.values(await api('/providers')).some((provider) => provider.configured)
  ) {
    history.replaceState(null, '', '#/settings');
    toast(
      'Add an API key to run analysis. You can create projects and import sources without one.',
    );
  }
  await route();
  const changes = new EventSource('/v1/events');
  changes.onmessage = (message) => {
    const { projectId } = JSON.parse(message.data);
    if (!projectId || projectId !== state.project?.id || !streamId) queueRefresh();
  };
  changes.onopen = () => queueRefresh();
  changes.onerror = () => {
    $('#activity').innerHTML = 'Connection interrupted. Reconnecting to the local engine…';
  };
} catch (e) {
  error(e.message);
}
