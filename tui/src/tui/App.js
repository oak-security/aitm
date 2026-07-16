// Screen state machine (Hive TUI pattern): key wizard → scope hint → ingest →
// sources → run (full pipeline or phase-by-phase with review gates) → report viewer.
// Stream events from orchestrate arrive on streamBus and are drained on a throttled
// interval so chatty deltas don't make Ink repaint every frame.
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import * as core from "../core.js";
import * as keys from "../keys.js";
import * as pipeline from "../pipeline.js";
import { ingestTargets, defaultProjectName } from "../sources.js";
import { h, GOLD, RISK_COLORS, Header, Panel, Select, MultiSelect, TextPrompt, Busy, KeyHints } from "./components.js";
import { ReportViewer } from "./report.js";

const MODEL_DEFAULTS = {
  openai: { fast: "gpt-5-mini", deep: "gpt-5.5" },
  anthropic: { fast: "claude-sonnet-5", deep: "claude-opus-4-8" }
};

const STAGE_ICONS = { pending: "○", active: "◐", done: "●", skipped: "◌", error: "✗" };
const STAGE_COLORS = { pending: "gray", active: "cyan", done: "green", skipped: "gray", error: "red" };

function applyStreamEvent(state, ev) {
  if (ev.event === "start") return { ...state, current: { label: ev.label, model: ev.model, tokens: 0 } };
  if (ev.event === "progress") {
    return state.current ? { ...state, current: { ...state.current, tokens: ev.tokens } } : state;
  }
  if (ev.event === "end") {
    const line = `✓ ${ev.label} (~${ev.tokens} tokens)`;
    return { current: null, log: [...state.log, line].slice(-5) };
  }
  if (ev.event === "error") {
    return { current: null, log: [...state.log, `✗ ${ev.message}`].slice(-5) };
  }
  return state;
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function App({ targets, configure }) {
  const { exit } = useApp();
  const [settings, setSettings] = React.useState(() => core.settings.get());

  const needsWizard = configure || !keys.readKey(settings.provider);
  const [screen, setScreen] = React.useState(needsWizard ? "keys-provider" : "scope");

  // wizard drafts
  const [provider, setProvider] = React.useState(settings.provider);
  const [keyError, setKeyError] = React.useState("");
  const [modelFast, setModelFast] = React.useState("");

  // run inputs
  const [scopeHint, setScopeHint] = React.useState("");
  const [ingestLog, setIngestLog] = React.useState([]);
  const [error, setError] = React.useState("");

  // run state
  const projectRef = React.useRef(null);
  const modeRef = React.useRef("auto");
  const retryRef = React.useRef(null);
  const [stages, setStages] = React.useState(() => pipeline.STEPS.map((s) => ({ id: s.id, title: s.title, status: "pending" })));
  const [reviewStep, setReviewStep] = React.useState(null);
  const [activity, setActivity] = React.useState({ current: null, log: [] });
  const [startedAt, setStartedAt] = React.useState(null);
  const [now, setNow] = React.useState(Date.now());
  const [statusLine, setStatusLine] = React.useState("");

  const markStage = React.useCallback((id, status) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  }, []);

  // Throttled stream-event drain (anti-flicker).
  React.useEffect(() => {
    const buf = [];
    const onEv = (p) => buf.push(p);
    core.streamBus.on("stream", onEv);
    const t = setInterval(() => {
      if (buf.length) setActivity((prev) => buf.splice(0).reduce(applyStreamEvent, prev));
    }, 150);
    return () => {
      core.streamBus.off("stream", onEv);
      clearInterval(t);
    };
  }, []);

  // Clock while running.
  React.useEffect(() => {
    if (screen !== "running") return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [screen]);

  // Cancel key while a phase runs.
  useInput(
    (input) => {
      if (input === "c") core.orchestrate.cancelAll();
    },
    { isActive: screen === "running" }
  );

  const fail = React.useCallback((err, retry) => {
    retryRef.current = retry;
    setError((err && err.message) || "Unexpected error.");
    setScreen("error");
  }, []);

  // ---- ingestion ----
  const startIngest = React.useCallback(
    (hint) => {
      setIngestLog([]);
      setScreen("ingest");
      const onLog = (line) => setIngestLog((prev) => [...prev, line].slice(-10));
      (async () => {
        const sources = await ingestTargets(targets, {
          scopeHint: hint,
          digest: core.digest,
          orchestrate: core.orchestrate,
          onLog
        });
        let project = core.store.create({ name: defaultProjectName(targets) });
        project.scope.inScope = hint || "";
        project.project.notes = `Ingested via aitm-tui from: ${targets.map((t) => t.ref).join(", ")}`;
        project.sources = sources;
        projectRef.current = core.store.persist(project);
        setScreen("sources");
      })().catch((err) => fail(err, () => startIngest(hint)));
    },
    [targets, fail]
  );

  // ---- pipeline execution ----
  const finishRun = React.useCallback(() => {
    setStatusLine("");
    setScreen("report");
  }, []);

  const continueFrom = React.useCallback(
    (index) => {
      const project = projectRef.current;
      let j = index;
      while (j < pipeline.STEPS.length) {
        const step = pipeline.STEPS[j];
        if (step.enabled && !step.enabled(project)) {
          markStage(step.id, "skipped");
          j += 1;
          continue;
        }
        if (modeRef.current === "steps" && step.id === "attack-trees") {
          const existing = new Set((project.attackTrees || []).map((t) => t.threatId));
          const candidates = (project.strideThreats || []).filter((t) => t.isApplicable !== false && !existing.has(t.id));
          if (!candidates.length) {
            markStage(step.id, "skipped");
            j += 1;
            continue;
          }
          setReviewStep({ index: j, step });
          setScreen("trees-select");
          return;
        }
        execute(j, {});
        return;
      }
      finishRun();
    },
    // execute is a stable useCallback from the same render; refs carry the run state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markStage, finishRun]
  );

  const execute = React.useCallback(
    (index, opts) => {
      const step = pipeline.STEPS[index];
      markStage(step.id, "active");
      setScreen("running");
      if (!startedAt) setStartedAt(Date.now());
      (async () => {
        projectRef.current = await step.run(projectRef.current, opts);
        markStage(step.id, "done");
        if (modeRef.current === "steps" && step.id !== "report") {
          setReviewStep({ index, step });
          setScreen("review");
        } else if (step.id === "report") {
          finishRun();
        } else {
          continueFrom(index + 1);
        }
      })().catch((err) => {
        markStage(step.id, "error");
        fail(err, () => execute(index, opts));
      });
    },
    [markStage, startedAt, continueFrom, finishRun, fail]
  );

  const startRun = React.useCallback(
    (mode) => {
      modeRef.current = mode;
      setStages(pipeline.STEPS.map((s) => ({ id: s.id, title: s.title, status: "pending" })));
      setStartedAt(Date.now());
      continueFrom(0);
    },
    [continueFrom]
  );

  // ---- report exports ----
  const exportReport = React.useCallback(
    (kind) => {
      const project = projectRef.current;
      const base = `${core.safeDownloadName(project.project.name)}-threat-model`;
      (async () => {
        if (kind === "md") {
          const file = path.join(process.cwd(), `${base}.md`);
          fs.writeFileSync(file, project.report.markdown);
          setStatusLine(`Saved ${file}`);
        } else {
          const pdf = await core.renderReportPdf({
            title: project.project.name,
            markdown: project.report.markdown,
            generatedAt: project.report.generatedAt
          });
          const file = path.join(process.cwd(), `${base}.pdf`);
          fs.writeFileSync(file, pdf);
          setStatusLine(`Saved ${file}`);
        }
      })().catch((err) => setStatusLine(`Export failed: ${err.message}`));
    },
    []
  );

  // ---------------- screens ----------------

  if (screen === "keys-provider") {
    return h(
      Box,
      { flexDirection: "column" },
      h(Header, { subtitle: "Setup: choose the AI provider." }),
      h(Select, {
        items: [
          { label: "OpenAI", value: "openai", hint: "env OPENAI_API_KEY" },
          { label: "Anthropic", value: "anthropic", hint: "env ANTHROPIC_API_KEY" }
        ],
        initialIndex: settings.provider === "anthropic" ? 1 : 0,
        onSelect: (value) => {
          setProvider(value);
          setKeyError("");
          setScreen(keys.readKey(value) && !configure ? "keys-model-fast" : "keys-key");
        }
      })
    );
  }

  if (screen === "keys-key") {
    return h(
      Box,
      { flexDirection: "column" },
      h(Header, { subtitle: `Setup: ${provider} API key (stored in ${keys.configDir()}/keys.json, or export it as an env var).` }),
      keyError ? h(Text, { color: "red" }, keyError) : null,
      h(TextPrompt, {
        label: `${provider} API key`,
        mask: true,
        required: true,
        onSubmit: (value) => {
          setScreen("keys-validating");
          (async () => {
            await core.getAdapter(provider).validateKey(value);
            keys.setKey(provider, value);
            setKeyError("");
            setScreen("keys-model-fast");
          })().catch((err) => {
            setKeyError(`Key check failed: ${err.message}`);
            setScreen("keys-key");
          });
        }
      })
    );
  }

  if (screen === "keys-validating") {
    return h(Box, { flexDirection: "column" }, h(Header, {}), h(Busy, { label: "Validating API key…" }));
  }

  if (screen === "keys-model-fast" || screen === "keys-model-deep") {
    const isFast = screen === "keys-model-fast";
    const fallback = MODEL_DEFAULTS[provider][isFast ? "fast" : "deep"];
    const current = settings.provider === provider ? settings[isFast ? "modelFast" : "modelDeep"] : fallback;
    return h(
      Box,
      { flexDirection: "column" },
      h(Header, { subtitle: `Setup: ${isFast ? "fast" : "deep"} model (${isFast ? "classification, model drafts, report" : "STRIDE, coordination"}). Enter keeps the shown value.` }),
      h(TextPrompt, {
        label: `${provider} ${isFast ? "fast" : "deep"} model`,
        initial: current || fallback,
        required: true,
        onSubmit: (value) => {
          if (isFast) {
            setModelFast(value);
            setScreen("keys-model-deep");
          } else {
            const next = core.settings.set({ provider, modelFast, modelDeep: value });
            setSettings(next);
            setScreen("scope");
          }
        }
      })
    );
  }

  if (screen === "scope") {
    return h(
      Box,
      { flexDirection: "column" },
      h(Header, { subtitle: "TRACE 0 — Scope. Sources: " + targets.map((t) => t.ref).join(", ") }),
      h(TextPrompt, {
        label: "Scope hint — describe what is in scope (empty = everything)",
        placeholder: 'e.g. "only the docs directory", "contracts and the whitepaper"',
        initial: scopeHint,
        onSubmit: (value) => {
          setScopeHint(value);
          startIngest(value);
        }
      })
    );
  }

  if (screen === "ingest") {
    return h(
      Box,
      { flexDirection: "column" },
      h(Header, { subtitle: "TRACE 1 — Ingest sources." }),
      h(Busy, { label: "Ingesting…" }),
      ...ingestLog.map((l, i) => h(Text, { key: String(i), color: "gray" }, l))
    );
  }

  if (screen === "sources") {
    const project = projectRef.current;
    return h(
      Box,
      { flexDirection: "column" },
      h(Header, { subtitle: `Project: ${project.project.name} · provider ${settings.provider} (${settings.modelFast} / ${settings.modelDeep})` }),
      h(
        Panel,
        { title: `Sources (${project.sources.length})` },
        ...project.sources.map((s, i) =>
          h(
            Text,
            { key: String(i) },
            `${s.type === "folder" ? "📁" : "📄"} ${s.label}`,
            h(Text, { color: "gray" }, `  ${s.summary || ""}`.slice(0, 100))
          )
        )
      ),
      h(Box, { marginTop: 1 }),
      h(Select, {
        items: [
          { label: "Run full pipeline", value: "auto", hint: "classify → model → STRIDE → trees → report, no gates" },
          { label: "Run phase by phase", value: "steps", hint: "review each phase before the next" },
          { label: "Change scope hint", value: "scope", hint: "re-ingest with a different hint" },
          { label: "Quit", value: "quit" }
        ],
        onSelect: (value) => {
          if (value === "quit") exit();
          else if (value === "scope") setScreen("scope");
          else startRun(value);
        }
      })
    );
  }

  if (screen === "running") {
    const elapsed = startedAt ? fmtElapsed(now - startedAt) : "00:00";
    return h(
      Box,
      { flexDirection: "column" },
      h(Header, { subtitle: `Running · ${elapsed} · press c to cancel` }),
      h(
        Panel,
        { title: "Pipeline" },
        ...stages.map((s) =>
          h(
            Text,
            { key: s.id, color: STAGE_COLORS[s.status] },
            `${STAGE_ICONS[s.status]} ${s.title}${s.status === "skipped" ? " (skipped)" : ""}`
          )
        )
      ),
      h(
        Panel,
        { title: "Activity" },
        ...activity.log.map((l, i) => h(Text, { key: String(i), color: "gray" }, l)),
        activity.current
          ? h(Busy, { label: `${activity.current.label} · ${activity.current.model} · ~${activity.current.tokens} tokens` })
          : h(Text, { color: "gray" }, "…")
      )
    );
  }

  if (screen === "review" && reviewStep) {
    const { index, step } = reviewStep;
    const lines = pipeline.summarize(step.id, projectRef.current);
    const regenLabel = step.id === "attack-trees" ? "Build more trees" : "Regenerate this phase";
    return h(
      Box,
      { flexDirection: "column" },
      h(Header, { subtitle: `Review · ${step.title}` }),
      h(Panel, { title: step.title }, ...lines.map((l, i) => h(Text, { key: String(i) }, l))),
      h(Box, { marginTop: 1 }),
      h(Select, {
        items: [
          { label: "Continue", value: "continue" },
          { label: regenLabel, value: "regen" },
          { label: "Quit (project is saved)", value: "quit" }
        ],
        onSelect: (value) => {
          if (value === "quit") exit();
          else if (value === "continue") continueFrom(index + 1);
          else if (step.id === "attack-trees") setScreen("trees-select");
          else execute(index, {});
        }
      })
    );
  }

  if (screen === "trees-select" && reviewStep) {
    const project = projectRef.current;
    const existing = new Set((project.attackTrees || []).map((t) => t.threatId));
    const candidates = pipeline
      .topThreats(project.strideThreats, project.strideThreats.length)
      .filter((t) => !existing.has(t.id));
    if (!candidates.length) {
      return h(
        Box,
        { flexDirection: "column" },
        h(Header, { subtitle: "TRACE 4 — Attack trees." }),
        h(Text, { color: "gray" }, "Every applicable threat already has a tree."),
        h(Select, {
          items: [{ label: "Continue", value: "continue" }],
          onSelect: () => continueFrom(reviewStep.index + 1)
        })
      );
    }
    const preselect = pipeline.topThreats(candidates, 3).map((t) => t.id);
    return h(
      Box,
      { flexDirection: "column" },
      h(Header, { subtitle: "TRACE 4 — Attack trees. Pick the threats to build trees for." }),
      h(MultiSelect, {
        items: candidates.map((t) => ({
          label: `[${t.risk}] ${t.title}`,
          value: t.id,
          hint: `${t.category} · ${t.surface}`.slice(0, 60)
        })),
        initialSelected: preselect,
        onSubmit: (ids) => {
          if (!ids.length) continueFrom(reviewStep.index + 1);
          else execute(reviewStep.index, { threatIds: ids });
        }
      }),
      h(KeyHints, { hints: ["risk colors:", ...Object.keys(RISK_COLORS).slice(0, 4)] })
    );
  }

  if (screen === "error") {
    return h(
      Box,
      { flexDirection: "column" },
      h(Header, {}),
      h(Text, { color: "red" }, error),
      h(Box, { marginTop: 1 }),
      h(Select, {
        items: [
          { label: "Retry", value: "retry" },
          { label: "Quit (progress is saved)", value: "quit" }
        ],
        onSelect: (value) => {
          if (value === "retry" && retryRef.current) retryRef.current();
          else exit();
        }
      })
    );
  }

  if (screen === "report") {
    const project = projectRef.current;
    const markdown = (project.report && project.report.markdown) || "(empty report)";
    return h(
      Box,
      { flexDirection: "column" },
      h(
        Box,
        null,
        h(Text, { color: GOLD, bold: true }, "AiTM report"),
        h(Text, { color: "gray" }, ` · ${project.project.name} · saved in project store`)
      ),
      h(ReportViewer, {
        markdown,
        statusLine,
        onKey: (input) => {
          if (input === "m") exportReport("md");
          else if (input === "p") exportReport("pdf");
          else if (input === "q") exit();
        }
      })
    );
  }

  return h(Box, null, h(Busy, { label: "Loading…" }));
}
