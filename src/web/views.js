import { esc, human, button, pill, empty, list, field, select, pretty } from './html.js';
import { markdown } from './markdown.js';

export const activeRun = (p) =>
  p?.runs.findLast((run) => ['queued', 'running'].includes(run.status));
export const title = (eyebrow, name, description = '') =>
  `<div class="view-heading"><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(name)}</h1>${description ? `<p class="lede">${esc(description)}</p>` : ''}</div>`;
const data = (p, phase) => p.artifacts[phase]?.data;
const rank = (p) =>
  [...(data(p, 'stride')?.threats || [])].sort(
    (a, b) => b.likelihood * b.impact - a.likelihood * a.impact || a.id.localeCompare(b.id),
  );
const phaseStatus = (p, id) => p.artifacts[id]?.status || 'pending';
const runButtons = (p) =>
  activeRun(p)
    ? button('cancel-run', 'Cancel run', '', 'danger')
    : button('run-review', 'Run with review gates', p.sources.length ? '' : 'disabled');
export function sidebar(s) {
  const p = s.project;
  return `<div class="brand"><img src="/ui/assets/aitm-mark.svg" alt="AiTM node graph"><div>AiTM<span>AI Threat Modeller</span></div><span class="version">v2</span></div>
    <div class="project-picker"><label for="project-picker">PROJECT</label><select id="project-picker" aria-label="Assessment"><option value="">Choose a project</option>${s.projects.map((item) => `<option value="${item.id}" ${p?.id === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select><div class="row">${button('new-project', '+ New project', '', 'side')}${button('open-project', 'Open project', '', 'side')}</div></div>
    <nav aria-label="TRACE phases">${
      p
        ? `<a href="#/projects/${p.id}/overview" ${s.view === 'overview' ? 'aria-current="page"' : ''}><span class="nav-number">◇</span>Overview</a>${s.phases
            .filter((ph) => ph.id !== 'ingest')
            .map(
              (ph) =>
                `<a href="#/projects/${p.id}/${ph.id}" ${s.view === ph.id ? 'aria-current="page"' : ''}><span class="nav-number">${ph.id === 'scope' ? '0·1' : s.meta.phases.findIndex((item) => item.id === ph.id)}</span><span>${esc({ scope: 'Sources & Scope', model: 'TRACE Model', stride: 'STRIDE', trees: 'Attack Trees', coordination: 'Coordination', report: 'Report' }[ph.id])}</span><span class="phase-dot ${phaseStatus(p, ph.id)}" title="${phaseStatus(p, ph.id)}" aria-label="${phaseStatus(p, ph.id)}"></span></a>`,
            )
            .join('')}`
        : '<p class="side-hint">Create a project, then add its sources.</p>'
    }</nav>
    <div class="sidebar-bottom">${button('import', 'Import project JSON', '', 'side')}${p ? `<a href="#/projects/${p.id}/log" ${s.view === 'log' ? 'aria-current="page"' : ''}>↳ Run history</a>` : ''}<a href="${p ? `#/projects/${p.id}/settings` : '#/settings'}" ${s.view === 'settings' ? 'aria-current="page"' : ''}>⚙ Settings & models</a><div class="key-status"><span class="phase-dot ${s.providers[p?.config.provider || 'openai']?.configured ? 'approved' : ''}"></span>${esc(p?.config.provider || 'openai')} · ${s.providers[p?.config.provider || 'openai']?.configured ? 'key configured' : 'key needed'}</div><div class="byline">by <img src="/ui/assets/oak-white.svg" alt="Oak Security"></div></div>`;
}
export function topbar(s) {
  return `${button('menu', '☰', 'aria-label="Toggle navigation" aria-expanded="false"', 'mobile-menu')}<div class="breadcrumb">Workspace <span>/</span> ${esc(s.project?.name || 'New assessment')}</div><div class="row">${s.project ? pill(activeRun(s.project) ? 'Running' : s.project.artifacts.report ? 'Report ready' : 'Draft', activeRun(s.project) ? 'gold' : '') + button('run-full', 'Run full pipeline', `${activeRun(s.project) || !s.project.sources.length ? 'disabled' : ''} title="Autorun every TRACE step, including the top three attack trees, without review pauses"`, 'primary') + button('export-project', 'Export project') : pill('Local workbench')}</div>`;
}
export function progress(s) {
  const p = s.project,
    run = activeRun(p) || p?.runs.at(-1),
    event = s.event || run?.events.at(-1);
  if (s.busy)
    return `<span class="spinner"></span><strong>${esc(s.busy)}</strong><span class="muted">Keep this server running.</span>`;
  if (!run)
    return `<span class="status-dot"></span><strong>Ready</strong><span class="muted">Sequential TRACE · source → model → threats → report</span>`;
  const running = ['queued', 'running'].includes(run.status);
  const completed = s.phases.filter((ph) => p.artifacts[ph.id]).length;
  const request = event?.batch
    ? event
    : s.request || run.events.findLast((e) => e.type === 'request' && e.phase === run.phase);
  const lastRequest = run.events.findLast((e) => e.type === 'request' && e.phase === run.phase);
  const batch = running && request?.batches ? `Batch ${request.batch}/${request.batches} · ` : '';
  const provider = request?.model
    ? `${request.provider}/${request.model}`
    : lastRequest?.model
      ? `${lastRequest.provider}/${lastRequest.model}`
      : '';
  const quietSeconds = event?.at
    ? Math.max(0, Math.floor((Date.now() - Date.parse(event.at)) / 1000))
    : 0;
  const activity = running
    ? `${batch}${event?.message || 'Starting TRACE…'}${quietSeconds >= 15 ? ` · waiting ${quietSeconds}s since last update` : ''}`
    : run.error
      ? `Paused at ${run.phase === 'ingest' ? 'source classification' : human(run.phase)}. Open Details, then Run full pipeline to retry.`
      : `${completed}/${s.phases.length} phases available`;
  const since = run.startedAt
    ? Math.max(
        0,
        Math.floor(
          ((running ? Date.now() : Date.parse(run.finishedAt || run.startedAt)) -
            Date.parse(run.startedAt)) /
            1000,
        ),
      )
    : 0;
  return `${running ? '<span class="spinner"></span>' : '<span class="status-dot"></span>'}<strong>${esc(running ? (run.phase === 'ingest' ? `Classifying${request?.batches ? ` · ${request.batch}/${request.batches}` : ' sources'}` : human(event?.phase || run.phase || 'Starting')) : human(run.status))}</strong><span class="activity-message" title="${esc(activity)}">${esc(activity)}</span><span class="activity-metrics" title="${esc(provider)}">${since}s · ${event?.characters ? `${event.characters.toLocaleString()} chars` : `${(run.usage.inputTokens + run.usage.outputTokens).toLocaleString()} tokens`}${running && provider ? ` · ${esc(provider)}` : ''}</span>${running ? button('cancel-run', 'Cancel', '', 'small') : ''}${p ? `<a href="#/projects/${p.id}/log">Details</a>` : ''}`;
}
export function welcome(s) {
  return `${title('TRACE / YOUR WORKSPACE', 'Projects', 'Keep each assessment and its sources together. Create a project or reopen a saved one. Nothing is imported automatically.')}<div class="card pipeline-card"><div><h2>Start a new assessment</h2><p>Add public URLs, architecture documents, specifications and zipped repositories to the same project.</p></div><div class="stack">${button('new-project', 'New project', '', 'primary')}${button('open-project', 'Open project')}${button('import', 'Import project JSON')}</div></div><h2>Saved projects <span class="count">${s.projects.length}</span></h2>${s.projects.length ? `<div class="card flush"><ol class="phase-list">${s.projects.map((p) => `<li><a href="#/projects/${p.id}/overview"><strong>${esc(p.name)}</strong>${pill(`${p.sources} sources`)}<span class="hint">${esc(p.lastRun || 'Not run')}</span><span>→</span></a></li>`).join('')}</ol></div>` : empty('No saved projects yet', 'Create a named project, then import its sources.')}<div class="notice">Source content is sent to your selected AI provider only when you run an assessment. Results remain drafts until reviewed.</div>`;
}
export function sourceForm(replacing = false) {
  return `<p class="muted">${replacing ? 'Choose one replacement for this source. Other sources stay in the project.' : 'Import several documents or ZIP repositories, or paste one public URL or local path per line.'} Changes invalidate dependent analysis.</p><label class="check"><input type="checkbox" id="run-after-import"> Run full pipeline after import</label><div class="card"><h3>Documents & repository ZIPs</h3><p class="hint">PDF, DOCX, source/text files and ZIP archives. ZIP contents follow the same source filters as local repositories.</p><label class="btn primary file-button">Choose documents or ZIPs<input type="file" ${replacing ? '' : 'multiple'} data-upload="sources" aria-label="Choose source files"></label></div><form data-form="sources">${field('locations', 'Public URLs or local paths', '', { area: true, required: true })}<p class="hint">${replacing ? 'One explicit source.' : 'One source per line.'} Empty input never imports the current folder.</p><div class="row"><button class="btn primary">${replacing ? 'Replace source' : 'Import sources'}</button>${button('close-dialog', 'Cancel')}</div></form>`;
}
export function overview(s) {
  const p = s.project,
    model = data(p, 'model'),
    ingest = data(p, 'ingest');
  return `${title('ASSESSMENT / OVERVIEW', p.name, 'From source evidence to a model, ranked threats and a practical roadmap.')}<div class="card pipeline-card"><div><span class="eyebrow">ONE SEQUENTIAL FLOW</span><h2>Run the full TRACE pipeline</h2><p>Classify the source, model the system, rank STRIDE threats, build attack trees for the top three threats, and assemble the report.</p><p class="hint">Use Run full pipeline above to autorun every step without approval pauses. Outputs remain drafts. Completed steps are reused.</p></div><div class="stack">${!p.sources.length ? `<a class="btn primary" href="#/projects/${p.id}/scope">Add sources →</a>` : ''}${runButtons(p)}${p.artifacts.report ? `<a class="btn secondary" href="#/projects/${p.id}/report">Read report →</a>` : ''}</div></div>
    <div class="stats">${[
      ['Sources', p.sources.length, 'scope'],
      ['Protected assets', model?.protectedAssets.length || 0, 'model'],
      ['STRIDE threats', data(p, 'stride')?.threats.length || 0, 'stride'],
      ['Attack trees', data(p, 'trees')?.trees.length || 0, 'trees'],
    ]
      .map(
        ([label, value, view]) =>
          `<a href="#/projects/${p.id}/${view}" class="stat"><span>${esc(label)}</span><strong>${value.toString().padStart(2, '0')}</strong><span class="stat-arrow">↗</span></a>`,
      )
      .join('')}</div>
    <div class="grid-2"><section class="card"><h2>System profile</h2>${ingest ? `<div class="row">${pill(ingest.profile, 'gold')}${ingest.pillars.map((v) => pill(v)).join('')}</div><p>${esc(ingest.summary)}</p><p class="muted">${esc(ingest.rationale)}</p>` : '<p class="muted">The first analysis step will classify your source and identify its actors and boundaries.</p>'}</section><section class="card"><h2>Scope</h2><p class="preserve">${esc(p.scope) || 'No scope provided.'}</p><a href="#/projects/${p.id}/scope">Edit scope →</a></section></div>
    <h2>Assessment progress</h2><div class="card flush"><ol class="phase-list">${s.phases.map((ph) => `<li><a href="#/projects/${p.id}/${ph.id === 'ingest' ? 'scope' : ph.id}"><span class="phase-index">${s.meta.phases.findIndex((v) => v.id === ph.id)}</span><strong>${esc(ph.title)}</strong>${pill(phaseStatus(p, ph.id), phaseStatus(p, ph.id) === 'approved' ? 'approved' : '')}<span>→</span></a></li>`).join('')}</ol></div><details class="maintenance"><summary>Assessment actions</summary><div class="row">${button('restart', 'Restart full pipeline', '', 'danger')}${button('delete', 'Delete assessment', '', 'danger')}</div></details>`;
}
export function gate(s, phase) {
  const p = s.project,
    artifact = p.artifacts[phase],
    enabled = s.phases.some((p) => p.id === phase),
    busy = activeRun(p),
    requiresReview = s.meta.phases.find((p) => p.id === phase)?.gate;
  if (!enabled)
    return '<div class="notice">This optional phase is disabled. Enable it in Settings & models.</div>';
  return `<div class="card review-bar"><div><strong>${artifact ? human(artifact.status) : 'Pending'}</strong><p class="hint">${artifact?.review ? `${artifact.review.reviewer ? `Reviewed by ${esc(artifact.review.reviewer)}` : 'Review approved'}${artifact.review.notes ? ` · ${esc(artifact.review.notes)}` : ''}` : requiresReview ? 'Review is explicit. Approving this step unlocks the next review gate.' : 'This step needs no review.'}</p></div><div class="row">${artifact && phase !== 'scope' ? button('edit-artifact', 'Edit draft', `data-phase="${phase}" ${busy ? 'disabled' : ''}`) : ''}${artifact && requiresReview ? button('approve', artifact.status === 'approved' ? 'Record review' : 'Approve review', `data-phase="${phase}" ${busy ? 'disabled' : ''}`) : ''}${phase !== 'scope' ? button('generate', artifact ? 'Regenerate' : 'Generate step', `data-phase="${phase}" ${busy ? 'disabled' : ''}`, 'primary') : ''}</div></div>${artifact?.reviewNotes?.length ? `<details class="notice warn"><summary>${artifact.reviewNotes.length} evidence review note(s)</summary>${list(artifact.reviewNotes.map((note) => `${note.claim}: ${note.note}`))}</details>` : ''}`;
}
export function sources(s) {
  const p = s.project,
    ingest = data(p, 'ingest');
  return `${title('TRACE / PHASES 0–1', 'Sources & Scope', 'Set the boundaries and inspect the complete source snapshot used by the engine.')}<form class="card" data-form="scope" data-revision="${p.revision}">${field('name', 'Assessment name', p.name, { required: true })}${field('scope', 'Scope and boundaries', p.scope, { area: true })}<button class="btn primary" ${activeRun(p) ? 'disabled' : ''}>Save scope</button><span class="hint">Changing scope invalidates dependent analysis.</span></form>
    <div class="spread"><h2>Source inventory</h2>${button('add-sources', '+ Add sources', activeRun(p) ? 'disabled' : '')}</div>${p.sources.map((source) => `<section class="card"><div class="spread"><div><h3>${esc(source.label)}</h3><p class="hint">${esc(source.kind)} · ${source.files.length} file(s) · ${source.files.reduce((sum, f) => sum + f.text.length, 0).toLocaleString()} characters</p></div><div class="row">${button('replace-source', 'Replace source', `data-source="${source.id}" ${activeRun(p) ? 'disabled' : ''}`)}${['local', 'url', 'git'].includes(source.kind) ? button('sync', 'Refresh snapshot', `data-source="${source.id}" ${activeRun(p) ? 'disabled' : ''}`) : ''}${button('remove-source', 'Remove', `data-source="${source.id}" ${activeRun(p) ? 'disabled' : ''}`, 'danger')}</div></div><p class="hint code">${esc(source.locator || source.label)}</p>${source.warnings?.length ? `<details class="notice warn"><summary>Source notes (${source.warnings.length})</summary>${list(source.warnings)}</details>` : ''}<details><summary>Browse ${source.files.length} evidence file(s)</summary><div class="file-list">${source.files.map((file) => button('evidence', `${esc(file.path)} <span>${file.text.split('\n').length} lines</span>`, `data-file="${esc(file.id)}"`, 'file-row')).join('')}</div></details></section>`).join('')}${!p.sources.length ? empty('Add your sources', 'Import public URLs, documents and ZIP repositories. Each source has its own saved snapshot.') : ''}<h2>Ingest & classify</h2>${ingest ? `<div class="card"><div class="row">${pill(ingest.profile, 'gold')}${ingest.pillars.map((v) => pill(v)).join('')}</div><p>${esc(ingest.summary)}</p><p>${esc(ingest.rationale)}</p><h3>Candidate objects</h3>${ingest.candidates.map((c) => `<p><strong>${esc(c.name)}</strong> · ${esc(c.description)}</p>${evidence(c)}`).join('')}<h3>Questions for source review</h3>${list(ingest.missingEvidence)}</div>` : empty('Ready to classify', 'Run the full pipeline or generate this step after reviewing the source inventory.')}${gate(s, 'ingest')}`;
}
export function evidence(item) {
  return `<div class="evidence">${(item.evidence || []).map((e) => button('evidence', `↗ ${esc(e.fileId)}:${e.startLine}–${e.endLine}`, `data-file="${esc(e.fileId)}" data-line="${e.startLine}" data-end="${e.endLine}"`, 'citation')).join('')}${item.assumption ? `<p class="assumption"><strong>Assumption:</strong> ${esc(item.assumption)}</p>` : ''}</div>`;
}
const itemEdit = (phase, key, index) =>
  button(
    'edit-item',
    'Edit details',
    `data-phase="${phase}" data-key="${key}" data-index="${index}"`,
    'small',
  );
export function model(s) {
  const p = s.project,
    model = data(p, 'model');
  return `${title('TRACE / PHASE 2', 'Construct TRACE Model', 'Threat actors, roles, protected assets, critical invariants and the edges between them.')}${gate(s, 'model')}${model ? `<p class="lede">${esc(model.overview)}</p>${['threatActors', 'roles', 'protectedAssets', 'invariants', 'components', 'edges'].map((key) => `<section><h2>${key === 'invariants' ? 'Critical invariants' : human(key)} <span class="count">${model[key].length}</span></h2><div class="object-grid">${model[key].map((item, index) => `<article class="card object-card"><div class="spread">${pill(item.id)}${itemEdit('model', key, index)}</div><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p>${key === 'edges' ? `<div class="edge">${esc(item.from)} <span>→</span> ${esc(item.to)}</div><p class="hint">${esc(item.kind)} · ${esc(item.boundary)}</p>` : ''}${evidence(item)}</article>`).join('') || '<p class="muted">None identified.</p>'}</div></section>`).join('')}<section class="card"><h2>Open questions</h2>${list(model.openQuestions)}</section>` : empty('Build the model', 'Classify your source first, then generate the TRACE model or run the full pipeline.')}`;
}
export function stride(s) {
  const p = s.project,
    d = data(p, 'stride'),
    threats = rank(p);
  return `${title('TRACE / PHASE 3', 'STRIDE Identification & Ranking', 'Explore threats in risk order. Every scenario connects back to model objects and source evidence.')}${gate(s, 'stride')}${
    d
      ? `<div class="card filter-row">${field('threat-search', 'Find a threat')}${select('threat-category', 'STRIDE category', ['All categories', ...new Set(threats.map((t) => t.category))], 'All categories')}</div><p class="hint">Ranked by likelihood × impact (1–25). Attack trees in a full run cover the top three threats.</p><div id="threats">${threats
          .map(
            (threat, index) =>
              `<article class="card threat-card" data-threat="${esc(`${threat.id} ${threat.title} ${threat.scenario}`.toLowerCase())}" data-category="${esc(threat.category)}"><div class="spread"><div class="row">${pill(`#${index + 1}`)}${pill(threat.category)}${pill(`${threat.likelihood * threat.impact} / 25`, threat.likelihood * threat.impact >= 15 ? 'risk-high' : 'gold')}</div>${itemEdit(
                'stride',
                'threats',
                d.threats.findIndex((t) => t.id === threat.id),
              )}</div><h2>${esc(threat.title)}</h2><p>${esc(threat.scenario)}</p><p class="hint">${esc(threat.id)} · Likelihood ${threat.likelihood} × Impact ${threat.impact} · ${esc(threat.confidence)} confidence</p><p>${esc(threat.rationale)}</p><details><summary>Controls, mitigations & evidence</summary><div class="grid-2"><div><h3>Existing controls</h3>${list(threat.existingControls)}</div><div><h3>Mitigations</h3>${list(threat.mitigations)}</div></div><dl>${['feasibility', 'incentives', 'blastRadius', 'timeSensitivity', 'targetIds', 'actorIds', 'assetIds', 'invariantIds'].map((key) => `<dt>${human(key)}</dt><dd>${esc(Array.isArray(threat[key]) ? threat[key].join(', ') : threat[key])}</dd>`).join('')}</dl>${evidence(threat)}</details></article>`,
          )
          .join(
            '',
          )}</div><div id="no-threats" class="notice" hidden>No threats match these filters.</div><details class="card"><summary>Model coverage & open questions</summary>${d.coverage.map((row) => `<p><strong>${esc(row.objectId)}</strong> → ${esc(row.threatIds.join(', '))}<br>${esc(row.explanation)}</p>`).join('')}${list(d.openQuestions)}</details>`
      : empty('Rank the threats', 'Generate STRIDE after constructing the TRACE model.')
  }`;
}
export function trees(s) {
  const p = s.project,
    d = data(p, 'trees');
  const branch = (nodes, parent = null, seen = new Set()) =>
    `<ul>${nodes
      .filter((n) => n.parentId === parent && !seen.has(n.id))
      .map((node) => {
        const visited = new Set([...seen, node.id]);
        return `<li><div class="tree-node"><div class="row">${pill(node.operator, node.operator === 'AND' ? 'gold' : '')}<strong>${esc(node.label)}</strong>${node.speculative ? pill('Assumption') : ''}</div><details><summary>Prerequisites & mitigations</summary>${list(node.prerequisites)}<h4>Mitigations</h4>${list(node.mitigations)}${evidence(node)}</details></div>${branch(nodes, node.id, visited)}</li>`;
      })
      .join('')}</ul>`;
  return `${title('TRACE / PHASE 4', 'Build Attack Trees', 'Understand the steps and conditions needed to realize the highest ranked threats.')}${gate(s, 'trees')}${d ? `${d.trees.map((tree) => `<section class="card"><div class="row">${pill(tree.threatId, 'gold')}<span class="hint">${esc(data(p, 'stride')?.threats.find((t) => t.id === tree.threatId)?.title)}</span></div><h2>${esc(tree.goal)}</h2><div class="tree">${branch(tree.nodes)}</div></section>`).join('')}<p class="hint">AND requires all child paths. OR requires one child path. LEAF is an individual action.</p>${d.omitted.length ? `<div class="card"><h3>Omitted threats</h3>${list(d.omitted.map((v) => (typeof v === 'string' ? v : pretty(v))))}</div>` : ''}` : empty('Trace the attack paths', 'A full pipeline builds trees for the top three STRIDE threats, or all threats when fewer than three exist.')}`;
}
export function coordination(s) {
  const d = data(s.project, 'coordination');
  return `${title('TRACE / PHASE 5', 'Collusion & Coordination', 'Examine shared dependencies, incentives and the coalitions that could cause harm.')}${gate(s, 'coordination')}${d ? `${d.scenarios.map((item, index) => `<article class="card"><div class="spread">${pill(item.id, 'gold')}${itemEdit('coordination', 'scenarios', index)}</div><h2>${esc(item.title)}</h2><dl>${['actorIds', 'assetIds', 'threshold', 'incentive', 'consequence'].map((key) => `<dt>${human(key)}</dt><dd>${esc(Array.isArray(item[key]) ? item[key].join(', ') : item[key])}</dd>`).join('')}</dl><div class="grid-2"><div><h3>Shared dependencies</h3>${list(item.sharedDependencies)}</div><div><h3>Mitigations</h3>${list(item.mitigations)}</div></div>${evidence(item)}</article>`).join('') || empty('No scenarios identified', 'Review the source and assumptions before concluding that coordination is irrelevant.')}<div class="card"><h3>Assumptions</h3>${list(d.assumptions)}<h3>Open questions</h3>${list(d.openQuestions)}</div>` : empty('Inspect coordination', 'This phase runs automatically when classification identifies coordinating actors. You can override this in Settings.')}`;
}
export function report(s) {
  const p = s.project;
  return `${title('TRACE / PHASE 6', 'Roadmap & Report', 'Read the complete Markdown report, review it, or choose an export.')}${gate(s, 'report')}${p.artifacts.report ? `<div class="report-tools card"><div class="row">${button('report-preview', 'Read report', `aria-pressed="${!s.rawReport}"`)}${button('report-raw', 'Markdown source', `aria-pressed="${Boolean(s.rawReport)}"`)}</div><div class="row"><a class="btn secondary" href="/v1/projects/${p.id}/report" download>Download Markdown</a><a class="btn secondary" href="/v1/projects/${p.id}/report?format=pdf" download>Download PDF</a></div></div>${s.report == null ? '<p class="loading">Loading the complete report…</p>' : s.rawReport ? `<pre class="card raw-report">${esc(s.report)}</pre>` : renderReport(s.report)}<p class="hint">Assessment stored in <code>${esc(s.health.dataDir)}/${p.id}.json</code>. Exports are saved to your browser's download location.</p>` : empty('Your report will appear here', 'Run the full pipeline to assemble the roadmap and report from the preceding TRACE phases.')}`;
}
function renderReport(text) {
  const rendered = markdown(text);
  return `<div class="report-layout"><details class="report-contents" open><summary>IN THIS REPORT</summary><nav aria-label="Report sections">${rendered.headings
    .filter((h) => h.level === 2)
    .map((h) => `<a href="#${h.id}" data-section="${h.id}">${esc(h.title)}</a>`)
    .join(
      '',
    )}</nav></details><article class="report-paper markdown">${rendered.html}</article></div>`;
}
export function settings(s) {
  const p = s.project,
    selected = s.settingsProvider || p?.config.provider || 'openai',
    status = s.providers[selected];
  const config = p?.config || {
    ...status,
    provider: selected,
    effort: 'medium',
    trees: true,
    treeLimit: 3,
    coordination: 'auto',
  };
  const catalog = s.catalogs[selected];
  const models = catalog?.models || [{ id: status.fastModel }, { id: status.deepModel }];
  const modelOptions = (current) =>
    models.some((m) => m.id === current) ? models : [{ id: current }, ...models];
  const sameProvider = selected === config.provider;
  const fast = sameProvider ? config.fastModel : status.fastModel,
    deep = sameProvider ? config.deepModel : status.deepModel;
  const providerName = (id) => (id === 'openai' ? 'OpenAI' : 'Anthropic');
  const noProject =
    '<div class="card"><h2>Models</h2><p class="hint">Models are set for each assessment. A new assessment uses the provider that has a key (OpenAI first). Open an assessment to select other models.</p></div>';
  const modelsForm = () =>
    `<form data-form="models" data-provider="${selected}" data-revision="${p.revision}" class="card"><div class="spread"><h2>Models</h2>${button('refresh-models', 'Refresh list', `data-provider="${selected}"`)}</div>${sameProvider ? '' : `<p class="notice warn">Not saved. This assessment uses ${providerName(config.provider)} until you select <strong>Save assessment settings</strong>.</p>`}<p id="catalog-notice" class="hint">${esc(catalog?.notice || (catalog ? 'Compatible account models.' : 'Loading account models… Defaults are available.'))}</p><div class="grid-2">${select('fastModel', 'Fast model', modelOptions(fast), fast)}${select('deepModel', 'Deep model', modelOptions(deep), deep)}</div><p class="hint">Fast: classification, TRACE model, trees and report. Deep: STRIDE and coordination.</p>${select('effort', 'Reasoning effort', ['low', 'medium', 'high'], config.effort)}<h2>Optional phases</h2><div class="grid-2">${select(
      'trees',
      'Attack trees',
      [
        { id: 'true', name: 'Enabled' },
        { id: 'false', name: 'Disabled' },
      ],
      String(config.trees),
    )}${select(
      'treeLimit',
      'Number of trees (review runs)',
      Array.from({ length: 10 }, (_, i) => String(i + 1)),
      String(config.treeLimit),
    )}${select(
      'coordination',
      'Coordination',
      [
        { id: 'auto', name: 'Automatic from classification' },
        { id: 'on', name: 'Always run' },
        { id: 'off', name: 'Disabled' },
      ],
      config.coordination,
    )}</div><p class="hint">A full pipeline always includes attack trees for the top three threats. Saving changed model settings invalidates generated analysis; API key changes alone do not.</p><button class="btn primary" ${activeRun(p) ? 'disabled' : ''}>Save assessment settings</button></form>`;
  return `${title('CONFIGURATION', 'Settings & Models', 'Manage provider credentials and choose the models for this assessment.')}<div class="card">${select(
    'settings-provider',
    'AI provider',
    [
      { id: 'openai', name: 'OpenAI' },
      { id: 'anthropic', name: 'Anthropic' },
    ],
    selected,
  )}</div>
    <form data-form="credentials" data-provider="${selected}" class="card"><div class="spread"><h2>${selected === 'openai' ? 'OpenAI' : 'Anthropic'} API key</h2>${pill(status.configured ? 'Key configured' : 'Key needed', status.configured ? 'gold' : '')}</div><p class="hint" data-key-source>Current source: ${esc(status.keySource)}. A saved replacement takes precedence over environment settings.</p>${field('apiKey', 'New API key', '', { type: 'password' })}${selected === 'anthropic' ? field('workspaceId', 'Workspace ID (optional; blank keeps current)') : ''}<div class="row"><button class="btn primary">Save key</button>${button('test-provider', 'Test connection', `data-provider="${selected}"`)}</div><p class="hint">${s.health.keyFile ? `Keys are stored privately in <code>${esc(s.health.keyFile)}</code> (mode 600).` : 'Keys are kept in this server session; persistent credential storage was not configured by its host.'} Existing keys are never shown.</p></form>
    ${p ? modelsForm() : noProject}<div class="notice">AI analysis sends the accepted source text to the selected provider. Results remain drafts until you record a review.</div>`;
}
export function log(s) {
  const runs = [...s.project.runs].reverse();
  return `${title('ASSESSMENT', 'Run History', 'Durable progress, provider usage and errors. Closing a browser tab leaves the engine running.')}${runs.map((run, index) => `<details class="card" ${index === 0 ? 'open' : ''}><summary>${pill(human(run.status), run.status === 'failed' ? 'risk-high' : '')} ${esc(run.startedAt || run.createdAt)} · ${esc(run.mode)}</summary>${run.error ? `<p class="notice warn">${esc(run.error)}</p>` : ''}<p class="hint code">${esc(run.id)} · ${run.usage.inputTokens} input / ${run.usage.outputTokens} output tokens</p><div class="event-log">${run.events.map((event) => `<div><time>${esc(event.at.slice(11, 19))}</time><span>${esc(event.phase || '')}</span><strong>${esc(human(event.type))}</strong><span>${esc(event.message)}</span></div>`).join('')}</div></details>`).join('') || empty('No runs yet', 'Start from Overview to run the full pipeline or walk through the review gates.')}`;
}
export const view = (s) => {
  if (!s.project) return s.view === 'settings' ? settings(s) : welcome(s);
  return (
    { overview, scope: sources, model, stride, trees, coordination, report, settings, log }[
      s.view
    ] || overview
  )(s);
};
