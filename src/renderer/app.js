"use strict";

/* AiTM renderer. Vanilla workbench driving the TRACE phases through window.api (IPC).
   The renderer is untrusted: it holds no secrets and performs no I/O except via api.*
   Wrapped in an IIFE so top-level consts stay function-scoped and never collide with the
   non-configurable global properties that contextBridge installs (e.g. window.api). */

(() => {

const api = window.api;

// Hosted web build: server owns a single OpenAI key and forces the models, so there
// is no Settings screen and no per-user key gating. Desktop leaves this false.
const HOSTED = Boolean(window.AITM_HOSTED);

const PROFILES = [
  "Unclassified", "Generic IT system", "Web application / SaaS", "Cloud / infrastructure",
  "Mobile application", "Enterprise network", "Data pipeline / ML system", "IoT / embedded",
  "ICS / OT", "DeFi protocol", "Layer 1 blockchain", "Layer 2 / rollup", "Bridge / cross-chain system",
  "DAO / governance system", "Oracle / keeper network", "Wallet / custody system", "Appchain / module", "Other"
];
const STRIDE_CATEGORIES = ["Spoofing", "Tampering", "Repudiation", "Information disclosure", "Denial of service", "Elevation of privilege"];
const LIKELIHOOD = ["N/A", "Low", "Medium", "High"];
const SEVERITY = ["N/A", "Informational", "Low", "Medium", "High", "Critical"];

// Phase id -> view label (also validates the active view). Scope (P0) is merged into
// the Sources page, so it routes to the same view and has no separate nav entry.
const PHASE_VIEW = {
  scope: "Sources & Scope",
  ingest: "Sources & Scope",
  "trace-model": "TRACE Model",
  stride: "STRIDE",
  "attack-trees": "Attack Trees",
  coordination: "Coordination",
  report: "Report"
};
// Sidebar nav order (excludes scope; it lives on the Sources page).
const NAV_PHASES = [
  ["ingest", "Sources & Scope", "0·1"],
  ["trace-model", "TRACE Model", "2"],
  ["stride", "STRIDE", "3"],
  ["attack-trees", "Attack Trees", "4"],
  ["coordination", "Coordination", "5"],
  ["report", "Report", "6"]
];

// Provider model menus. Anthropic defaults to the latest Opus (deep) and Sonnet (fast).
const PROVIDERS = {
  openai: {
    label: "OpenAI",
    fast: ["gpt-5-mini", "gpt-5", "gpt-5.5"],
    deep: ["gpt-5.5", "gpt-5", "gpt-5-mini"],
    defFast: "gpt-5-mini",
    defDeep: "gpt-5.5"
  },
  anthropic: {
    label: "Anthropic",
    fast: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-8"],
    deep: ["claude-opus-4-8", "claude-sonnet-4-6"],
    defFast: "claude-sonnet-4-6",
    defDeep: "claude-opus-4-8"
  }
};

// Empty-row templates for table editors.
const SECTION_FIELDS = {
  protectedAssets: { name: "", location: "", access: "", impact: "" },
  threatActors: { name: "", capability: "", targets: "", coordinationPotential: "" },
  roles: { role: "", holder: "", powers: "", constraints: "" },
  invariants: { name: "", type: "", statement: "", consequence: "" },
  components: { name: "", kind: "", trust: "", privileges: "", dependencies: "" },
  trustBoundaries: { name: "", from: "", to: "", risk: "" },
  valueFlows: { name: "", flow: "", assets: "" }
};
const SECTION_COLUMNS = {
  protectedAssets: [["name", "Asset"], ["location", "Location"], ["access", "Access"], ["impact", "Impact if lost"]],
  threatActors: [["name", "Actor"], ["capability", "Capability"], ["targets", "Targets"], ["coordinationPotential", "Coordination potential"]],
  roles: [["role", "Role"], ["holder", "Holder"], ["powers", "Powers"], ["constraints", "Constraints"]],
  invariants: [["name", "Invariant"], ["type", "Type"], ["statement", "Statement"], ["consequence", "If violated"]],
  components: [["name", "Component"], ["kind", "Kind"], ["trust", "Trust"], ["privileges", "Privileges"], ["dependencies", "Dependencies"]],
  trustBoundaries: [["name", "Boundary"], ["from", "From"], ["to", "To"], ["risk", "Risk"]],
  valueFlows: [["name", "Flow"], ["flow", "Path"], ["assets", "Assets"]]
};

const state = {
  projects: [],
  project: null,
  view: "overview",
  keyStatus: { encryptionAvailable: true, providers: {} },
  settings: null,
  busy: {},
  treeSel: [],     // persisted attack-tree threat selection (survives re-render/build)
  auto: false,     // full-pipeline run in progress
  autoStatus: "",
  keyVerified: {}  // provider -> true once a key has tested OK or a call succeeded
};

const app = document.getElementById("app");
let saveTimer = null;

/* ---------------- utilities ---------------- */

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function toast(message, isError) {
  const t = document.getElementById("toast");
  t.textContent = message;
  t.className = "toast" + (isError ? " err" : "");
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3000);
}

// ---- persistent AI status bar (imperative; outside #app so render() never wipes it) ----
let streamLabel = "";
let streamTokens = 0;
let streamError = "";
function markVerified() {
  state.keyVerified[activeProvider()] = true;
  renderStatusBar();
}
function renderStatusBar() {
  const el = document.getElementById("aistatus");
  const provId = activeProvider();
  const provLabel = (PROVIDERS[provId] || {}).label || provId;
  const ks = keyState(provId);
  // Hosted uses a shared server key: show readiness, never the key's last4.
  const keyText = HOSTED
    ? "shared key"
    : !ks.configured ? "no key set" : `key ${state.keyVerified[provId] ? "valid" : "set"} ····${ks.last4}`;
  const busy = aiInFlight();
  let right;
  if (busy) {
    const activity = streamTokens > 0 ? `${streamTokens.toLocaleString()} tokens` : "thinking…";
    right = `<span class="spinner"></span><span class="aistatus-text">${esc(streamLabel || "Working")}… ${activity}</span><button class="aistatus-cancel" data-action="cancel-ai">Cancel</button>`;
  } else if (streamError) {
    right = `<span class="aistatus-err">⚠ ${esc(streamError)}</span><button class="aistatus-cancel" data-action="dismiss-err">Dismiss</button>`;
  } else {
    right = '<span class="aistatus-idle">Idle</span>';
  }
  el.innerHTML = `
    <div class="aistatus-left">
      <span class="aistatus-tag">AI</span>
      <span class="aistatus-provider">${esc(provLabel)}</span>
      <span class="aistatus-key"><span class="dot ${ks.configured ? "on" : "off"}"></span>${esc(keyText)}</span>
    </div>
    <div class="aistatus-right">${right}</div>`;
}
function onStreamEvent(p) {
  if (!p) return;
  if (p.event === "start") { streamLabel = p.label; streamTokens = 0; streamError = ""; }
  else if (p.event === "progress") { if (p.label) streamLabel = p.label; streamTokens = p.tokens || streamTokens; }
  else if (p.event === "end") { streamTokens = p.tokens || streamTokens; }
  else if (p.event === "error") { streamError = p.message || "Failed."; }
  renderStatusBar();
}

// Promise-based text prompt (window.prompt is unavailable in Electron). Lives on
// document.body so render() — which only rewrites #app — never wipes it.
function promptText({ title, label, placeholder = "", value = "", confirmLabel = "OK" }) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2>${esc(title)}</h2>
      <label class="field"><span>${esc(label)}</span>
        <input type="text" id="__prompt" placeholder="${esc(placeholder)}" value="${esc(value)}" /></label>
      <div class="row" style="justify-content:flex-end;margin-top:6px">
        <button class="btn ghost" data-modal="cancel">Cancel</button>
        <button class="btn gold" data-modal="ok">${esc(confirmLabel)}</button>
      </div></div>`;
    document.body.appendChild(back);
    const input = back.querySelector("#__prompt");
    input.focus();
    input.select();
    const close = (val) => { back.remove(); resolve(val); };
    back.addEventListener("click", (e) => {
      if (e.target === back) return close(null);
      const act = e.target.closest("[data-modal]");
      if (act) close(act.dataset.modal === "ok" ? (input.value.trim() || null) : null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") close(input.value.trim() || null);
      else if (e.key === "Escape") close(null);
    });
  });
}

function getByPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setByPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i];
    if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistProject, 500);
}
async function persistProject() {
  if (!state.project) return;
  try {
    await api.projects.update(state.project.project.id, state.project);
  } catch (err) {
    toast(humanError(err), true);
  }
}

function humanError(err) {
  const m = (err && err.message) || String(err);
  return m.replace(/^Error:\s*/, "").replace(/^[a-z_]+:\s*/, "");
}

function isEnabled(id) {
  return state.project && Array.isArray(state.project.phasesEnabled) && state.project.phasesEnabled.includes(id);
}

// Active provider and its per-provider key status.
function activeProvider() {
  return (state.settings && state.settings.provider) || "openai";
}
function keyState(provider = activeProvider()) {
  return (state.keyStatus.providers && state.keyStatus.providers[provider]) || { configured: false, last4: "" };
}
function keyConfigured() {
  // Hosted: the server holds the shared key; a missing key surfaces as a provider
  // error on the call itself rather than a "go to Settings" gate that doesn't exist.
  return HOSTED || keyState().configured;
}
function keyPlaceholder(provider) {
  return provider === "anthropic" ? "sk-ant-…" : "sk-…";
}

/* ---------------- data loading ---------------- */

async function init() {
  app.addEventListener("click", onClick);
  app.addEventListener("input", onBind);
  app.addEventListener("change", onBind);
  document.getElementById("aistatus").addEventListener("click", (e) => {
    if (e.target.closest("[data-action='cancel-ai']")) { api.ai.cancel(); toast("Cancelling…"); }
    else if (e.target.closest("[data-action='dismiss-err']")) { streamError = ""; renderStatusBar(); }
  });
  api.ai.onStream(onStreamEvent);
  await refreshAll();
}

async function refreshAll() {
  state.keyStatus = await api.keystore.status();
  state.settings = await api.settings.get();
  state.projects = await api.projects.list();
  const active = (await api.projects.getActive()).id;
  if (active) {
    state.project = await api.projects.get(active);
  } else if (state.projects.length) {
    await openProject(state.projects[0].id, false);
  } else {
    state.project = null;
  }
  render();
}

async function openProject(id, doRender = true) {
  await api.projects.setActive(id);
  state.project = await api.projects.get(id);
  state.treeSel = []; // selection is per project
  if (!PHASE_VIEW[state.view] && state.view !== "settings" && state.view !== "phases") state.view = "overview";
  if (PHASE_VIEW[state.view] && !isEnabled(state.view)) state.view = "overview";
  if (doRender) render();
}

/* ---------------- render: shell ---------------- */

// True while any AI provider call (single step or the full pipeline) is in flight.
function aiInFlight() {
  if (state.auto) return true;
  return ["ai-classify", "ai-trace-model", "ai-stride", "ai-coordination", "ai-report", "ai-attack-tree", "process-sources"]
    .some((k) => state.busy[k]);
}

function render() {
  let main;
  if (HOSTED && state.view === "settings") state.view = "overview"; // no settings screen when hosted
  if (state.view === "settings") main = settingsView(); // global; reachable without a project
  else if (state.project) main = viewHtml();
  else main = emptyState();
  app.innerHTML = `${sidebar()}<main class="main">${main}</main>`;
  renderStatusBar();
}

function sidebar() {
  const p = state.project;
  const navItems = [["overview", "Overview", "·"]];
  NAV_PHASES.forEach(([id, label, num]) => {
    if (p && isEnabled(id)) navItems.push([id, label, num]);
  });

  const options = state.projects.map(
    (pr) => `<option value="${pr.id}" ${p && pr.id === p.project.id ? "selected" : ""}>${esc(pr.name)}</option>`
  ).join("");

  return `
  <aside class="sidebar">
    <div class="brand" data-action="view" data-view="overview" title="Home">
      <img class="brand-mark" src="assets/logo/aitm-mark.svg" alt="" />
      <div class="brand-name">AiTM<span class="brand-sub">AI Threat Modeller</span></div>
    </div>
    <div class="sb-section">
      <div class="sb-label">Project</div>
      <select class="project-select" data-action="select-project">${options || '<option>No projects</option>'}</select>
      <div class="sb-actions">
        <button class="btn" data-action="new-project">New</button>
        <button class="btn" data-action="import-project">Import</button>
        ${p ? '<button class="btn" data-action="export-project">Export</button>' : ""}
      </div>
    </div>
    ${p ? `
    <div class="sb-label">TRACE Workflow</div>
    <ul class="nav">
      ${navItems.map(([id, label, num]) => navButton(id, label, num)).join("")}
      <li><button class="${state.view === "phases" ? "active" : ""}" data-action="view" data-view="phases"><span class="num">⚙</span> Phases</button></li>
    </ul>` : ""}
    ${HOSTED ? "" : `<ul class="nav" style="margin-top:auto">
      <li><button class="${state.view === "settings" ? "active" : ""}" data-action="view" data-view="settings"><span class="num">⚙</span> Settings</button></li>
    </ul>`}
    <div class="sidebar-footer">
      <div class="oak-by"><span>by</span><img src="assets/logo/oak-white.svg" alt="Oak Security" /></div>
      ${api.app ? '<a data-action="reveal-folder">Reveal data folder</a>' : ""}
    </div>
  </aside>`;
}

function navButton(id, label, num) {
  const p = state.project;
  let badge = "";
  if (id === "stride") badge = p.strideThreats.length ? `<span class="badge">${p.strideThreats.length}</span>` : "";
  else if (id === "ingest") badge = p.sources.length ? `<span class="badge">${p.sources.length}</span>` : "";
  else if (id === "attack-trees") badge = p.attackTrees.length ? `<span class="badge">${p.attackTrees.length}</span>` : "";
  else if (p.approvals && p.approvals[id]) badge = '<span class="ok-dot"></span>';
  return `<li><button class="${state.view === id ? "active" : ""}" data-action="view" data-view="${id}">
    <span class="num">${num}</span> ${esc(label)} ${badge}</button></li>`;
}

function emptyState() {
  return `<div class="empty">
    <img src="assets/logo/app-icon.svg" alt="" />
    <h1>AiTM — AI Threat Modeller</h1>
    <p>Local-first, AI-assisted threat modeling with the TRACE framework.</p>
    <p style="margin-top:18px"><button class="btn gold" data-action="new-project">Create a project</button>
      <button class="btn ghost" data-action="import-project">Import JSON</button></p>
  </div>`;
}

/* ---------------- render: views ---------------- */

function viewHtml() {
  switch (state.view) {
    case "overview": return overviewView();
    case "scope": return sourcesView();
    case "ingest": return sourcesView();
    case "classification": return classificationView();
    case "trace-model": return traceModelView();
    case "stride": return strideView();
    case "attack-trees": return treesView();
    case "coordination": return coordinationView();
    case "report": return reportView();
    case "phases": return phasesView();
    case "settings": return settingsView();
    default: return overviewView();
  }
}

function viewHeader(eyebrow, title, lede) {
  return `<p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1>${lede ? `<p class="lede">${esc(lede)}</p>` : ""}`;
}

function genButton(action, label, busyKey) {
  const busy = state.busy[busyKey || action];
  return `<button class="btn gold" data-action="${action}" ${busy ? "disabled" : ""}>
    ${busy ? '<span class="spinner"></span> Working…' : esc(label)}</button>`;
}

// Ghost-style secondary button with its own busy state (used for Add folder/file).
function addButton(action, label) {
  const busy = state.busy[action];
  return `<button class="btn ghost" data-action="${action}" ${busy ? "disabled" : ""}>
    ${busy ? '<span class="spinner"></span> Adding…' : esc(label)}</button>`;
}

function aiGateNotice() {
  if (keyConfigured()) return "";
  const label = (PROVIDERS[activeProvider()] || {}).label || "provider";
  return `<div class="notice warn"><h3>No ${esc(label)} API key configured</h3>
    <p>AI drafting needs your ${esc(label)} API key. Add it in <a data-action="view" data-view="settings" style="text-decoration:underline;cursor:pointer">Settings</a>. The key is stored encrypted on this device and never leaves it except in calls to the provider.</p></div>`;
}

function overviewView() {
  const p = state.project;
  const c = p.classification;
  return `<div class="view">
    <div class="spread">
      <div>${viewHeader("Project", p.project.name, "Status and completeness of this threat model.")}</div>
      <button class="btn danger" data-action="delete-project">Delete project</button>
    </div>
    <div class="card">
      <label class="field"><span>Project name</span><input type="text" data-path="project.name" value="${esc(p.project.name)}" /></label>
      <label class="field"><span>Notes</span><textarea data-path="project.notes" placeholder="Engagement context, links, caveats…">${esc(p.project.notes)}</textarea></label>
    </div>
    <div class="card">
      <div class="spread">
        <div><strong>Run the full pipeline</strong>
          <div class="hint">“I’m feeling lucky” — classify, build the TRACE model, run STRIDE, then build attack trees, coordination, and the report for every enabled phase, auto-approving each gate. Overwrites existing drafts.</div></div>
        ${genButton("auto-run", "Run full pipeline", "auto-run")}
      </div>
      ${state.auto ? `<div class="notice" style="margin-top:12px"><p><span class="spinner"></span> &nbsp;${esc(state.autoStatus)}</p></div>` : ""}
    </div>
    <h2>Classification</h2>
    ${aiGateNotice()}
    <div class="card">
      <div class="row">
        <span class="pill gold">${esc(c.profile)}</span>
        <span class="pill">confidence: ${esc(c.confidence)}</span>
        ${c.coordinationRelevant ? '<span class="pill">coordination relevant</span>' : ""}
      </div>
      <label class="field" style="margin-top:14px"><span>Profile (override)</span>
        <select class="input" data-path="classification.profile">${PROFILES.map((x) => `<option ${x === c.profile ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
      ${c.rationale ? `<p class="hint">${esc(c.rationale)}</p>` : ""}
      ${(c.warnings || []).length ? `<div class="notice warn" style="margin-top:10px"><p>${c.warnings.map(esc).join("<br>")}</p></div>` : ""}
    </div>
    <h2>Completeness</h2>
    <div class="card"><table class="editor"><tbody>
      ${completenessRow("Sources", p.sources.length, "ingest")}
      ${completenessRow("Protected assets", p.traceModel.protectedAssets.length, "trace-model")}
      ${completenessRow("Components", p.traceModel.components.length, "trace-model")}
      ${completenessRow("STRIDE threats", p.strideThreats.length, "stride")}
      ${isEnabled("attack-trees") ? completenessRow("Attack trees", p.attackTrees.length, "attack-trees") : ""}
      ${completenessRow("Report generated", p.report.markdown ? "yes" : "no", "report")}
    </tbody></table></div>
  </div>`;
}
function completenessRow(label, value, view) {
  return `<tr><td><strong>${esc(label)}</strong></td><td>${esc(value)}</td>
    <td style="text-align:right"><button class="btn ghost sm" data-action="view" data-view="${view}">Open</button></td></tr>`;
}

// Merged Sources (P1) + Scope (P0): sources and the ingest controls at the top, scope
// at the bottom.
function sourcesView() {
  const p = state.project;
  const s = p.scope;
  const rows = p.sources.map((src) => `
    <tr><td><strong>${esc(src.label)}</strong><div class="hint">${esc(src.type)} · ${esc((src.summary || "").slice(0, 140))}</div></td>
      <td style="text-align:right"><button class="row-remove" data-action="remove-source" data-id="${src.id}" title="Remove">✕</button></td></tr>`).join("");
  return `<div class="view">
    ${viewHeader("TRACE · Phases 0–1", "Sources & Scope", "Add local sources and (optionally) the scope, then press Ingest to process and classify.")}
    <h2 style="margin-top:6px">Sources</h2>
    <p class="hint" style="margin:0 0 12px">${api.ingest.repo ? "Folders, files, or a git repository URL." : "Local folders and files only."} Add several (e.g. code plus docs); they complement each other.</p>
    <div class="row" style="margin-bottom:14px">
      ${addButton("ingest-folder", "Add folder")}
      ${addButton("ingest-files", "Add file")}
      ${api.ingest.repo ? addButton("ingest-repo", "Add repository") : ""}
    </div>
    <div class="card flush">
      <table class="editor"><thead><tr><th>Source</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="2" class="hint" style="padding:18px">No sources yet. Use “Add folder” or “Add file” above.</td></tr>'}</tbody></table>
    </div>
    <h2>Scope <span class="hint" style="font-weight:400">(optional)</span></h2>
    <div class="card">
      <label class="field"><span>Boundaries</span><textarea data-path="scope.boundaries" placeholder="What systems, environments, versions are in this assessment?">${esc(s.boundaries)}</textarea></label>
      <div class="grid-2">
        <label class="field"><span>In scope</span><textarea data-path="scope.inScope">${esc(s.inScope)}</textarea></label>
        <label class="field"><span>Out of scope</span><textarea data-path="scope.outOfScope">${esc(s.outOfScope)}</textarea></label>
      </div>
      <label class="field"><span>Assumptions</span><textarea data-path="scope.assumptions">${esc(s.assumptions)}</textarea></label>
    </div>
    ${aiGateNotice()}
    <div class="card spread">
      <div><strong>Ingest & classify</strong>
        <div class="hint">Process the added sources, classify the system, and open the overview.</div></div>
      ${genButton("process-sources", "Ingest", "process-sources")}
    </div>
  </div>`;
}

function classificationView() { return overviewView(); }

function traceModelView() {
  const tm = state.project.traceModel;
  const sections = [
    ["protectedAssets", "Protected assets"], ["threatActors", "Threat actors"], ["roles", "Privileged roles"],
    ["invariants", "Invariants"], ["components", "Components"], ["trustBoundaries", "Trust boundaries"], ["valueFlows", "Value / data flows"]
  ];
  return `<div class="view">
    ${viewHeader("TRACE · Phase 2", "Construct TRACE Model", "AI-drafted, fully editable. Review before STRIDE.")}
    ${aiGateNotice()}
    <div class="row" style="margin-bottom:16px">${genButton("ai-trace-model", "Draft model with AI")}</div>
    ${sections.map(([key, title]) => sectionEditor(key, title, tm[key] || [])).join("")}
    <div class="card">
      <h2 style="margin-top:0">Open questions</h2>
      ${listEditor("traceModel.openQuestions", tm.openQuestions || [])}
    </div>
    ${approveBar("trace-model")}
  </div>`;
}

function sectionEditor(key, title, rows) {
  const cols = SECTION_COLUMNS[key];
  const head = cols.map(([, label]) => `<th>${esc(label)}</th>`).join("") + "<th></th>";
  const body = rows.map((row, i) => `<tr>
    ${cols.map(([ck]) => `<td><textarea data-path="traceModel.${key}.${i}.${ck}" rows="3">${esc(row[ck])}</textarea></td>`).join("")}
    <td><button class="row-remove" data-action="remove-row" data-section="traceModel.${key}" data-index="${i}">✕</button></td>
  </tr>`).join("");
  return `<div class="card flush"><div class="spread" style="padding:12px 16px"><strong>${esc(title)}</strong>
      <button class="btn ghost sm" data-action="add-row" data-section="${key}">+ Add</button></div>
    <table class="editor"><thead><tr>${head}</tr></thead>
    <tbody>${body || `<tr><td colspan="${cols.length + 1}" class="hint" style="padding:14px">None yet.</td></tr>`}</tbody></table></div>`;
}

function listEditor(path, values) {
  const rows = values.map((v, i) => `<div class="row" style="margin-bottom:6px">
    <input type="text" data-path="${path}.${i}" value="${esc(v)}" />
    <button class="row-remove" data-action="remove-list" data-path="${path}" data-index="${i}">✕</button></div>`).join("");
  return `${rows}<button class="btn ghost sm" data-action="add-list" data-path="${path}">+ Add</button>`;
}

function strideView() {
  const p = state.project;
  const cards = p.strideThreats.map((t, i) => strideCard(t, i)).join("");
  return `<div class="view">
    ${viewHeader("TRACE · Phase 3", "STRIDE Identification & Ranking", "Per-surface threats with likelihood, impact, and risk.")}
    ${aiGateNotice()}
    <div class="row" style="margin-bottom:16px">${genButton("ai-stride", "Generate STRIDE with AI")}
      <button class="btn ghost" data-action="add-stride">+ Add threat</button></div>
    ${cards || '<div class="card hint">No STRIDE threats yet. Use “Generate STRIDE with AI” to draft them from your TRACE model, or add threats manually.</div>'}
    ${approveBar("stride")}
  </div>`;
}
function strideCard(t, i) {
  const opt = (arr, v) => arr.map((x) => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  return `<div class="card">
    <div class="grid-2">
      <label class="field"><span>Surface / component</span><input type="text" data-path="strideThreats.${i}.surface" value="${esc(t.surface)}" /></label>
      <label class="field"><span>Category</span><select class="input" data-path="strideThreats.${i}.category">${opt(STRIDE_CATEGORIES, t.category)}</select></label>
    </div>
    <label class="field"><span>Title</span><input type="text" data-path="strideThreats.${i}.title" value="${esc(t.title)}" /></label>
    <label class="field"><span>Scenario</span><textarea data-path="strideThreats.${i}.scenario">${esc(t.scenario)}</textarea></label>
    <div class="row">
      <label class="field" style="flex:1"><span>Likelihood</span><select class="input" data-path="strideThreats.${i}.likelihood">${opt(LIKELIHOOD, t.likelihood)}</select></label>
      <label class="field" style="flex:1"><span>Impact</span><select class="input" data-path="strideThreats.${i}.impact">${opt(SEVERITY, t.impact)}</select></label>
      <label class="field" style="flex:1"><span>Risk</span><select class="input" data-path="strideThreats.${i}.risk">${opt(SEVERITY, t.risk)}</select></label>
    </div>
    <label class="field"><span>Mitigations</span><textarea data-path="strideThreats.${i}.mitigations">${esc(t.mitigations)}</textarea></label>
    <div class="spread"><span class="risk ${esc(t.risk)}">Risk: ${esc(t.risk)}</span>
      <button class="row-remove" data-action="remove-stride" data-index="${i}">Remove threat ✕</button></div>
  </div>`;
}

function treesView() {
  const p = state.project;
  const sel = new Set(state.treeSel);
  const hasTree = (id) => (p.attackTrees || []).some((t) => t.threatId === id);
  const threatOptions = p.strideThreats.map((t) => {
    const title = esc(t.title || t.surface);
    if (hasTree(t.id)) {
      return `<label class="row tree-opt generated" style="gap:6px" title="Already generated — delete its tree to regenerate"><input type="checkbox" checked disabled> <span>${title}</span><span class="tag">tree ✓</span></label>`;
    }
    return `<label class="row tree-opt" style="gap:6px"><input type="checkbox" data-tree-threat="${t.id}" ${sel.has(t.id) ? "checked" : ""}> ${title}</label>`;
  }).join("");
  const trees = p.attackTrees.map((tree, ti) => {
    const threat = p.strideThreats.find((x) => x.id === tree.threatId);
    return `<div class="card">
      <div class="spread"><strong>${esc(tree.name)}</strong>
        <button class="row-remove" data-action="remove-tree" data-index="${ti}">✕</button></div>
      ${threat ? `<div class="hint" style="margin-bottom:6px">for: ${esc(threat.title || threat.surface)}</div>` : ""}
      <div class="tree">${renderTree(tree.nodes || [])}</div></div>`;
  }).join("");
  return `<div class="view">
    ${viewHeader("TRACE · Phase 4", "Build Attack Trees", "Decompose threats into attack paths. Optional phase.")}
    ${aiGateNotice()}
    <div class="card"><div class="spread"><strong>Build trees for the ticked threats</strong>${genButton("ai-attack-tree", "Build attack trees")}</div>
      <p class="hint" style="margin:6px 0 0">Threats that already have a tree are ticked and greyed, and are skipped. Tick new threats and generate to add their trees.</p>
      <div style="margin-top:10px;display:grid;gap:4px">${threatOptions || '<span class="hint">Generate STRIDE threats first.</span>'}</div></div>
    ${trees}
    ${approveBar("attack-trees")}
  </div>`;
}
function renderTree(nodes) {
  const byParent = {};
  nodes.forEach((n) => { (byParent[n.parentId || ""] = byParent[n.parentId || ""] || []).push(n); });
  const roots = byParent[""] || nodes.filter((n) => !nodes.some((m) => m.id === n.parentId));
  const walk = (list) => `<ul>${(list || []).map((n) => `<li>${esc(n.label)}${walk(byParent[n.id])}</li>`).join("")}</ul>`;
  return walk(roots);
}

function coordinationView() {
  const c = state.project.coordination;
  const cards = (c.scenarios || []).map((s, i) => `<div class="card">
    <div class="grid-2">
      <label class="field"><span>Actors</span><input type="text" data-path="coordination.scenarios.${i}.actors" value="${esc(s.actors)}" /></label>
      <label class="field"><span>Protected asset</span><input type="text" data-path="coordination.scenarios.${i}.asset" value="${esc(s.asset)}" /></label>
    </div>
    <label class="field"><span>Required coalition</span><textarea data-path="coordination.scenarios.${i}.coalition">${esc(s.coalition)}</textarea></label>
    <label class="field"><span>Incentive</span><textarea data-path="coordination.scenarios.${i}.incentive">${esc(s.incentive)}</textarea></label>
    <label class="field"><span>Consequence</span><textarea data-path="coordination.scenarios.${i}.consequence">${esc(s.consequence)}</textarea></label>
    <label class="field"><span>Mitigation</span><textarea data-path="coordination.scenarios.${i}.mitigation">${esc(s.mitigation)}</textarea></label>
    <button class="row-remove" data-action="remove-coord" data-index="${i}">Remove ✕</button>
  </div>`).join("");
  return `<div class="view">
    ${viewHeader("TRACE · Phase 5", "Collusion & Coordination Inspection", "Where distinct actor groups could coordinate to cause harm. Supplements STRIDE.")}
    ${aiGateNotice()}
    <div class="row" style="margin-bottom:16px">${genButton("ai-coordination", "Analyze coordination with AI")}</div>
    ${cards || '<div class="card hint">No coordination scenarios yet.</div>'}
    ${c.notes ? `<div class="card"><strong>Notes</strong><p class="hint">${esc(c.notes)}</p></div>` : ""}
    ${approveBar("coordination")}
  </div>`;
}

function reportView() {
  const r = state.project.report;
  return `<div class="view">
    ${viewHeader("TRACE · Phase 6", "Roadmap & Report", "Assembled from your reviewed model. Disabled phases are excluded.")}
    ${aiGateNotice()}
    <div class="row" style="margin-bottom:16px">
      ${genButton("ai-report", r.markdown ? "Regenerate report" : "Generate report")}
      ${r.markdown ? `<button class="btn ghost" data-action="export-pdf" ${state.busy["export-pdf"] ? "disabled" : ""}>${state.busy["export-pdf"] ? '<span class="spinner"></span> Exporting…' : "Export PDF"}</button>` : ""}
      ${r.markdown ? `<button class="btn ghost" data-action="export-md" ${state.busy["export-md"] ? "disabled" : ""}>${state.busy["export-md"] ? '<span class="spinner"></span> Exporting…' : "Export Markdown"}</button>` : ""}
    </div>
    ${r.generatedAt ? `<p class="hint">Generated ${esc(r.generatedAt)}</p>` : ""}
    ${r.html ? `<iframe class="report-frame" sandbox="" srcdoc="${esc(r.html)}"></iframe>`
      : '<div class="card hint">No report yet. Generate one once the model and STRIDE analysis are reviewed.</div>'}
  </div>`;
}

function phasesView() {
  const reg = phaseRegistryLocal();
  return `<div class="view">
    ${viewHeader("Configuration", "Phases", "Disable any TRACE phase that does not apply to this engagement. Required phases stay on.")}
    <div class="card">
      ${reg.map((ph) => `<div class="phase-toggle">
        <button class="switch ${isEnabled(ph.id) ? "on" : ""}" data-action="toggle-phase" data-id="${ph.id}" ${ph.required ? "disabled" : ""}></button>
        <div><strong>P${ph.trace} · ${esc(ph.title)}</strong>
          <div class="req">${ph.required ? "Required" : "Optional"}</div></div>
      </div>`).join("")}
    </div>
  </div>`;
}
// Local mirror of the phase registry for display ordering; enablement comes from project state.
function phaseRegistryLocal() {
  return [
    { id: "scope", trace: 0, title: "Scope & Source Inventory", required: true },
    { id: "ingest", trace: 1, title: "Ingest Sources", required: true },
    { id: "trace-model", trace: 2, title: "Construct TRACE Model", required: true },
    { id: "stride", trace: 3, title: "STRIDE Identification & Ranking", required: true },
    { id: "attack-trees", trace: 4, title: "Build Attack Trees", required: false },
    { id: "coordination", trace: 5, title: "Collusion & Coordination Inspection", required: false },
    { id: "report", trace: 6, title: "Roadmap & Report", required: true }
  ];
}

function modelOptions(list, current) {
  const opts = list.includes(current) ? list.slice() : [current, ...list].filter(Boolean);
  return opts.map((m) => `<option ${m === current ? "selected" : ""}>${esc(m)}</option>`).join("");
}

function settingsView() {
  const s = state.settings || {};
  const provId = s.provider || "openai";
  const prov = PROVIDERS[provId] || PROVIDERS.openai;
  const ks = keyState(provId);
  const enc = state.keyStatus.encryptionAvailable !== false;
  return `<div class="view">
    ${viewHeader("Configuration", "Settings", "Choose a provider, then manage its own API key and models. Each provider keeps a separate key, stored encrypted on this device.")}
    ${!enc ? '<div class="notice warn"><h3>Secure storage unavailable</h3><p>The OS keychain is not available, so API keys cannot be stored securely and will not be saved.</p></div>' : ""}
    <div class="card">
      <label class="field" style="margin-bottom:0"><span>AI provider</span>
        <select class="input" data-setting="provider">
          ${Object.entries(PROVIDERS).map(([id, def]) => `<option value="${id}" ${provId === id ? "selected" : ""}>${esc(def.label)}</option>`).join("")}
        </select></label>
    </div>

    <div class="card">
      <div class="spread" style="margin-bottom:6px">
        <h2 style="margin:0">${esc(prov.label)}</h2>
        <span class="pill ${ks.configured ? "gold" : ""}">${ks.configured ? `key ····${esc(ks.last4)}` : "no key set"}</span>
      </div>
      <label class="field"><span>${esc(prov.label)} API key</span>
        <input type="password" id="apikey" placeholder="${ks.configured ? "Enter a new key to replace" : keyPlaceholder(provId)}" /></label>
      <div class="row">
        <button class="btn" data-action="save-key">Save key</button>
        <button class="btn ghost" data-action="test-key">Test key</button>
        ${ks.configured ? '<button class="btn danger" data-action="clear-key">Clear</button>' : ""}
      </div>
      <h2 style="font-size:1rem">Models</h2>
      <div class="grid-2">
        <label class="field"><span>Fast model</span><select class="input" data-setting="modelFast">${modelOptions(prov.fast, s.modelFast)}</select></label>
        <label class="field"><span>Deep model</span><select class="input" data-setting="modelDeep">${modelOptions(prov.deep, s.modelDeep)}</select></label>
      </div>
      <p class="hint" style="margin-bottom:0">Fast model: classification, model drafting, attack trees. Deep model: STRIDE, coordination, report.</p>
    </div>
    <div class="notice"><p>Threat modeling sends source digests to the selected provider. Nothing is uploaded except in those calls. Keep sensitive engagements in mind.</p></div>
  </div>`;
}

function approveBar(phaseId) {
  const done = state.project.approvals && state.project.approvals[phaseId];
  return `<div class="card spread"><span class="hint">Mark this phase reviewed once you are satisfied with the content.</span>
    <button class="btn ${done ? "ghost" : "gold"}" data-action="toggle-approve" data-id="${phaseId}">${done ? "Reviewed ✓ (undo)" : "Mark reviewed"}</button></div>`;
}

/* ---------------- events ---------------- */

function onBind(e) {
  const el = e.target;
  if (el.dataset && el.dataset.treeThreat !== undefined) {
    // Track the attack-tree selection in state so it survives re-render and building.
    const id = el.dataset.treeThreat;
    const set = new Set(state.treeSel);
    if (el.checked) set.add(id); else set.delete(id);
    state.treeSel = [...set];
  } else if (el.dataset && el.dataset.path && state.project) {
    setByPath(state.project, el.dataset.path, el.value);
    scheduleSave();
  } else if (el.dataset && el.dataset.setting === "provider") {
    changeProvider(el.value);
  } else if (el.dataset && el.dataset.setting) {
    saveSetting(el.dataset.setting, el.value);
  }
}

async function saveSetting(key, value) {
  try {
    state.settings = await api.settings.set({ [key]: value });
  } catch (err) { toast(humanError(err), true); }
}

async function changeProvider(p) {
  const def = PROVIDERS[p] || PROVIDERS.openai;
  try {
    state.settings = await api.settings.set({ provider: p, modelFast: def.defFast, modelDeep: def.defDeep });
    render();
    toast(`Provider set to ${def.label}. Enter that provider’s API key if it differs.`);
  } catch (err) { toast(humanError(err), true); }
}

async function onClick(e) {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const d = target.dataset;

  try {
    switch (action) {
      case "view":
        // Settings/Phases act as toggles: clicking the active one returns to Overview
        // (the start screen when no project is open), so you're never trapped.
        state.view = (d.view === state.view && (d.view === "settings" || d.view === "phases")) ? "overview" : d.view;
        render();
        break;
      case "select-project": break; // handled by change below
      case "new-project": await doNewProject(); break;
      case "import-project": await doImport(); break;
      case "export-project": await doExport(); break;
      case "delete-project": await doDeleteProject(); break;
      case "reveal-folder": await api.app.revealDataFolder(); break;

      case "ingest-folder": await runBusy("ingest-folder", doIngestFolder); break;
      case "ingest-files": await runBusy("ingest-files", doIngestFiles); break;
      case "ingest-repo": await runBusy("ingest-repo", doIngestRepo); break;
      case "remove-source": await mutate(() => { state.project.sources = state.project.sources.filter((s) => s.id !== d.id); }); break;

      case "process-sources": await doProcessSources(); break;
      case "ai-classify": await runAi("ai-classify", () => api.ai.classify(pid())); break;
      case "ai-trace-model": await runAi("ai-trace-model", () => api.ai.traceModel(pid())); break;
      case "ai-stride": await runAi("ai-stride", () => api.ai.stride(pid())); break;
      case "ai-coordination": await runAi("ai-coordination", () => api.ai.coordination(pid())); break;
      case "ai-report": await runAi("ai-report", () => api.ai.report(pid())); break;
      case "ai-attack-tree": await doBuildTree(); break;
      case "auto-run": await doAutoRun(); break;
      case "export-md": await runBusy("export-md", doExportMarkdown); break;

      case "add-row": await mutate(() => { state.project.traceModel[d.section].push({ ...SECTION_FIELDS[d.section] }); }); break;
      case "remove-row": await mutate(() => { getByPath(state.project, d.section).splice(Number(d.index), 1); }); break;
      case "add-list": await mutate(() => { const a = getByPath(state.project, d.path) || []; a.push(""); setByPath(state.project, d.path, a); }); break;
      case "remove-list": await mutate(() => { getByPath(state.project, d.path).splice(Number(d.index), 1); }); break;

      case "add-stride": await mutate(() => { state.project.strideThreats.push(newThreat()); }); break;
      case "remove-stride": await mutate(() => { state.project.strideThreats.splice(Number(d.index), 1); }); break;
      case "remove-tree": await mutate(() => { state.project.attackTrees.splice(Number(d.index), 1); }); break;
      case "remove-coord": await mutate(() => { state.project.coordination.scenarios.splice(Number(d.index), 1); }); break;

      case "toggle-phase": await doTogglePhase(d.id); break;
      case "toggle-approve": await mutate(() => { state.project.approvals = state.project.approvals || {}; state.project.approvals[d.id] = !state.project.approvals[d.id]; }); break;

      case "save-key": await doSaveKey(); break;
      case "test-key": await doTestKey(); break;
      case "clear-key": await doClearKey(); break;
      case "export-pdf": await runBusy("export-pdf", doExportPdf); break;
      default: break;
    }
  } catch (err) {
    toast(humanError(err), true);
  }
}

// Project select uses change event.
app.addEventListener("change", (e) => {
  const sel = e.target.closest('[data-action="select-project"]');
  if (sel) openProject(sel.value);
});

function pid() { return state.project.project.id; }
function newThreat() { return { id: crypto.randomUUID(), surface: "", category: "Spoofing", title: "", scenario: "", likelihood: "Medium", impact: "Medium", risk: "Medium", mitigations: "", tags: [], isApplicable: true, status: "draft" }; }

async function mutate(fn) {
  fn();
  await persistProject();
  render();
}

function setBusy(key, v) { state.busy[key] = v; }

async function runBusy(key, fn) {
  setBusy(key, true); render();
  try { await fn(); } finally { setBusy(key, false); render(); }
}

async function runAi(key, fn) {
  if (!keyConfigured()) { toast("Add your API key in Settings first.", true); return; }
  setBusy(key, true); render();
  try {
    state.project = await fn();
    markVerified();
    toast("Draft updated.");
  } finally {
    setBusy(key, false); render();
  }
}

async function doNewProject() {
  const name = await promptText({
    title: "New project",
    label: "Project name",
    placeholder: "e.g. Payments API threat model",
    confirmLabel: "Create project"
  });
  if (!name) return; // cancelled or empty
  state.project = await api.projects.create({ name });
  state.treeSel = [];
  state.projects = await api.projects.list();
  state.view = "scope";
  render();
}

async function doImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      state.project = await api.projects.import(text);
      state.treeSel = [];
      state.projects = await api.projects.list();
      state.view = "overview";
      render();
      toast("Project imported.");
    } catch (err) { toast(humanError(err), true); }
  };
  input.click();
}

async function doExport() {
  const json = await api.projects.export(pid());
  await navigator.clipboard.writeText(json).then(
    () => toast("Project JSON copied to clipboard."),
    () => toast("Could not copy export.", true)
  );
}

async function doDeleteProject() {
  const name = state.project.project.name;
  if (!window.confirm(`Delete "${name}"? This permanently removes the project and cannot be undone.`)) return;
  await api.projects.remove(pid());
  await api.projects.setActive("");      // no active project -> show the start screen
  state.projects = await api.projects.list();
  state.project = null;
  state.view = "overview";
  render();
  toast(`Deleted "${name}".`);
}

// "Ingest" CTA: process the added sources by running classification, then open Overview.
async function doProcessSources() {
  if (!keyConfigured()) { toast("Add your API key in Settings first.", true); return; }
  if (!state.project.sources.length) { toast("Add at least one folder or file first.", true); return; }
  setBusy("process-sources", true); render();
  try {
    state.project = await api.ai.classify(pid());
    markVerified();
    toast("Sources ingested and classified.");
    state.view = "overview";
  } catch (err) {
    toast(humanError(err), true);
  } finally {
    setBusy("process-sources", false); render();
  }
}

async function doIngestFolder() {
  const res = await api.ingest.folder();
  if (res.canceled) return;
  state.project.sources.push(res.source);
  await persistProject();
  toast(`Added folder: ${res.source.label}`);
}
// Web-only (feature-detected): the browser build exposes ingest.repo for git URLs.
async function doIngestRepo() {
  const url = await promptText({
    title: "Add repository",
    label: "Git / GitHub URL",
    placeholder: "https://github.com/owner/repo",
    confirmLabel: "Clone & ingest"
  });
  if (!url) return;
  const res = await api.ingest.repo(url);
  if (res.canceled) return;
  state.project.sources.push(res.source);
  await persistProject();
  toast(`Added repository: ${res.source.label}`);
}
async function doIngestFiles() {
  const res = await api.ingest.files();
  if (res.canceled) return;
  res.sources.forEach((s) => state.project.sources.push(s));
  await persistProject();
  toast(`Added ${res.sources.length} file(s).${res.errors && res.errors.length ? " Some were skipped." : ""}`);
}

function topThreats(threats, n) {
  const rank = { Critical: 5, High: 4, Medium: 3, Low: 2, Informational: 1, "N/A": 0 };
  return threats
    .filter((t) => t.isApplicable !== false)
    .slice()
    .sort((a, b) => (rank[b.risk] || 0) - (rank[a.risk] || 0))
    .slice(0, n);
}

async function doAutoRun() {
  if (!keyConfigured()) { toast("Add your API key in Settings first.", true); return; }
  if (!window.confirm("Run the full pipeline? This classifies, builds the TRACE model, runs STRIDE, then builds attack trees, coordination, and the report for enabled phases — auto-approving each step. Existing drafts will be overwritten.")) return;
  state.auto = true;
  state.busy["auto-run"] = true;
  const step = (msg) => { state.autoStatus = msg; render(); };
  try {
    step("Clearing previous results…");    state.project = await api.projects.reset(pid()); state.treeSel = [];
    step("Classifying the system…");      state.project = await api.ai.classify(pid());
    step("Drafting the TRACE model…");     state.project = await api.ai.traceModel(pid());
    step("Generating STRIDE threats…");    state.project = await api.ai.stride(pid());
    if (isEnabled("attack-trees") && state.project.strideThreats.length) {
      const top = topThreats(state.project.strideThreats, 3);
      step(`Building attack trees for the top ${top.length} threats…`);
      state.project = await api.ai.attackTree(pid(), { threatIds: top.map((t) => t.id) });
    }
    if (isEnabled("coordination")) { step("Analyzing collusion & coordination…"); state.project = await api.ai.coordination(pid()); }
    if (isEnabled("report")) { step("Writing the report…"); state.project = await api.ai.report(pid()); }
    markVerified();
    toast("Full pipeline complete.");
    state.view = "report";
  } catch (err) {
    toast("Pipeline stopped: " + humanError(err), true);
  } finally {
    state.auto = false;
    state.busy["auto-run"] = false;
    state.autoStatus = "";
    render();
  }
}

async function doExportMarkdown() {
  const res = await api.report.exportMarkdown(pid());
  if (res.canceled) return;
  toast("Markdown saved: " + res.path);
}

async function doBuildTree() {
  if (!keyConfigured()) { toast("Add your API key in Settings first.", true); return; }
  const selected = state.treeSel.slice();
  if (!selected.length) { toast("Tick at least one threat to generate trees for.", true); return; }
  setBusy("ai-attack-tree", true); render();
  try {
    state.project = await api.ai.attackTree(pid(), { threatIds: selected });
    markVerified();
    // drop now-generated threats from the pending selection (they show as greyed)
    state.treeSel = state.treeSel.filter((id) => !(state.project.attackTrees || []).some((t) => t.threatId === id));
    toast("Attack trees generated.");
  } finally { setBusy("ai-attack-tree", false); render(); }
}

async function doTogglePhase(id) {
  const enabled = new Set(state.project.phasesEnabled);
  if (enabled.has(id)) enabled.delete(id); else enabled.add(id);
  // keep canonical order
  state.project.phasesEnabled = phaseRegistryLocal().map((p) => p.id).filter((p) => enabled.has(p));
  if (id === "coordination") state.project.coordination.enabled = enabled.has("coordination");
  await persistProject();
  render();
}

async function doSaveKey() {
  const provider = activeProvider();
  const field = document.getElementById("apikey");
  const key = field ? field.value.trim() : "";
  if (!key) { toast("Enter a key first.", true); return; }
  state.keyStatus = await api.keystore.set(provider, key);
  state.keyVerified[provider] = false; // unverified until tested
  toast(`${PROVIDERS[provider].label} key saved. Testing…`);
  await doTestKey();
}
async function doTestKey() {
  const provider = activeProvider();
  try {
    await api.keystore.test(provider);
    state.keyVerified[provider] = true;
    toast(`${PROVIDERS[provider].label} key works.`);
  } catch (err) {
    state.keyVerified[provider] = false;
    toast("Key test failed: " + humanError(err), true);
  }
  state.keyStatus = await api.keystore.status();
  render();
}
async function doClearKey() {
  const provider = activeProvider();
  state.keyStatus = await api.keystore.clear(provider);
  delete state.keyVerified[provider];
  render();
  toast(`${PROVIDERS[provider].label} key cleared.`);
}

async function doExportPdf() {
  const res = await api.report.exportPdf(pid());
  if (res.canceled) return;
  toast("PDF saved: " + res.path);
}

init();

})();
