"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { createApplication, PIPELINE_STEPS, topThreats } = require("../src/main/application");

function fixture({ coordination = false } = {}) {
  let project = {
    project: { id: "11111111-1111-1111-1111-111111111111", name: "Demo" },
    classification: { profile: "Unclassified", coordinationRelevant: false },
    phasesEnabled: ["scope", "ingest", "trace-model", "stride", "attack-trees", "report"],
    traceModel: {},
    strideThreats: [],
    attackTrees: [],
    coordination: { enabled: false, scenarios: [], notes: "" },
    report: { markdown: "", html: "", generatedAt: "" }
  };
  const calls = [];
  const store = {
    list: () => [{ id: project.project.id, name: project.project.name }],
    get: () => project,
    create: () => project,
    update: (_id, patch) => (project = { ...project, ...patch }),
    remove: () => ({ ok: true }),
    setActive: (id) => ({ id }),
    getActive: () => project.project.id,
    exportProject: () => JSON.stringify(project),
    importProject: () => project,
    resetAnalysis: () => project,
    persist: (next) => (project = next)
  };
  const orchestrate = {
    classify: async () => {
      calls.push("classify");
      return { profile: "Web", coordinationRelevant: coordination };
    },
    traceModel: async () => {
      calls.push("trace-model");
      return { components: [{ id: "web" }] };
    },
    stride: async () => {
      calls.push("stride");
      return {
        threats: [
          { title: "low", risk: "Low", isApplicable: true },
          { title: "critical", risk: "Critical", isApplicable: true },
          { title: "excluded", risk: "High", isApplicable: false }
        ]
      };
    },
    attackTree: async (_project, threatId) => {
      calls.push(`attack-tree:${threatId}`);
      return { name: "tree" };
    },
    coordination: async () => {
      calls.push("coordination");
      return { scenarios: [{ title: "scenario" }], notes: "" };
    },
    report: async () => {
      calls.push("report");
      return { markdown: "# Report" };
    },
    cancelAll: () => ({ cancelled: 0 })
  };
  let nextId = 0;
  const app = createApplication({
    store,
    keystore: { status: () => ({}), setKey() {}, clearKey() {}, readKey: () => "key" },
    settings: { get: () => ({}), set: (patch) => patch },
    phases: {
      registry: () => [],
      seedEnabled: (_classification, enabled) =>
        coordination ? [...new Set([...enabled, "coordination"])] : enabled,
      isEnabled: (p, id) => p.phasesEnabled.includes(id)
    },
    orchestrate,
    getAdapter: () => ({ validateKey: async () => {} }),
    render: { toHtml: (markdown) => `<h1>${markdown.slice(2)}</h1>` },
    util: {
      appError: (code, message) => Object.assign(new Error(message), { code }),
      assertString: (value) => assert.equal(typeof value, "string"),
      uuid: () => `00000000-0000-0000-0000-${String(++nextId).padStart(12, "0")}`
    }
  });
  return { app, calls, getProject: () => project };
}

test("application: one command interface owns project operations", async () => {
  const { app } = fixture();
  assert.equal((await app.execute("projects.list"))[0].name, "Demo");
  assert.equal((await app.execute("projects.get", { id: "id" })).project.name, "Demo");
  await assert.rejects(() => app.execute("not.a.command"), (err) => err.code === "no_command");
});

test("application: full pipeline runs in order and skips disabled phases", async () => {
  const { app, calls, getProject } = fixture();
  const events = [];
  const result = await app.runPipeline(getProject().project.id, {
    attackTreeLimit: 1,
    onStep: (event) => events.push(`${event.event}:${event.step.id}`)
  });

  assert.deepEqual(calls, ["classify", "trace-model", "stride", `attack-tree:${getProject().strideThreats[1].id}`, "report"]);
  assert.deepEqual(result.steps.map((step) => step.status), ["completed", "completed", "completed", "completed", "skipped", "completed"]);
  assert.equal(result.project.report.markdown, "# Report");
  assert.deepEqual(events.slice(0, 2), ["started:classify", "completed:classify"]);
  assert.deepEqual(PIPELINE_STEPS.map((step) => step.id), ["classify", "trace-model", "stride", "attack-trees", "coordination", "report"]);
});

test("application: topThreats ranks risk and excludes non-applicable threats", () => {
  const threats = [
    { id: "low", risk: "Low", isApplicable: true },
    { id: "critical", risk: "Critical", isApplicable: true },
    { id: "excluded", risk: "High", isApplicable: false }
  ];
  assert.deepEqual(topThreats(threats, 2).map((threat) => threat.id), ["critical", "low"]);
});

test("application: pipeline options are validated at the shared interface", async () => {
  const { app, getProject } = fixture();
  await assert.rejects(
    () => app.runPipeline(getProject().project.id, { attackTreeLimit: -1 }),
    (err) => err.code === "bad_input"
  );
  await assert.rejects(
    () => app.runPipeline(getProject().project.id, { reset: "yes" }),
    (err) => err.code === "bad_input"
  );
});
