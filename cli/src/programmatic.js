function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function logger(quiet) {
  return quiet ? () => {} : (message) => process.stderr.write(`${message}\n`);
}

function positiveInt(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`--trees must be an integer from 0 to 100 (got "${value}").`);
  }
  return parsed;
}

function statusOf(project) {
  const applicable = (project.strideThreats || []).filter((threat) => threat.isApplicable !== false);
  const risks = {};
  for (const threat of applicable) risks[threat.risk || "Unknown"] = (risks[threat.risk || "Unknown"] || 0) + 1;
  return {
    id: project.project.id,
    name: project.project.name,
    profile: project.classification.profile,
    sources: (project.sources || []).length,
    threats: applicable.length,
    risks,
    attackTrees: (project.attackTrees || []).length,
    coordinationScenarios: (project.coordination.scenarios || []).length,
    reportGenerated: Boolean(project.report.markdown && project.report.markdown.trim()),
    updatedAt: project.project.updatedAt
  };
}

async function configure(application, flags) {
  const patch = {};
  if (flags.provider) {
    if (!["openai", "anthropic"].includes(flags.provider)) throw new Error("--provider must be openai or anthropic.");
    patch.provider = flags.provider;
  }
  if (flags.modelFast) patch.modelFast = flags.modelFast;
  if (flags.modelDeep) patch.modelDeep = flags.modelDeep;
  if (Object.keys(patch).length) await application.execute("settings.set", patch);
}

async function requireConfiguredProvider(application) {
  const [settings, status] = await Promise.all([
    application.execute("settings.get"),
    application.execute("keystore.status")
  ]);
  if (!status.providers?.[settings.provider]?.configured) {
    const variable = settings.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    throw new Error(`No ${settings.provider} API key configured. Set ${variable} or run the interactive TUI setup.`);
  }
}

function attachStream(streamBus, log) {
  const listener = (event) => {
    if (event.event === "start") log(`  ${event.label} (${event.model})`);
    if (event.event === "end") log(`  completed ${event.label} (~${event.tokens || 0} tokens)`);
    if (event.event === "error") log(`  failed: ${event.message || "provider error"}`);
  };
  streamBus.on("stream", listener);
  return () => streamBus.off("stream", listener);
}

async function createFromSources({ application, core, sourcesModule, args, flags, log }) {
  const targets = sourcesModule.resolveTargets(args);
  const sources = await sourcesModule.ingestTargets(targets, {
    scopeHint: flags.scope || "",
    digest: core.digest,
    orchestrate: core.orchestrate,
    onLog: log
  });
  let project = await application.execute("projects.create", {
    name: flags.name || sourcesModule.defaultProjectName(targets)
  });
  project.scope.inScope = flags.scope || "";
  project.project.notes = `Ingested via aitm -p from: ${targets.map((target) => target.ref).join(", ")}`;
  project.sources = sources;
  return application.execute("projects.update", {
    id: project.project.id,
    patch: { project: project.project, scope: project.scope, sources: project.sources }
  });
}

async function runFull(application, projectId, flags, log) {
  await requireConfiguredProvider(application);
  return application.runPipeline(projectId, {
    reset: Boolean(flags.reset),
    attackTreeLimit: positiveInt(flags.trees, 3),
    onStep: ({ event, step }) => {
      if (event === "started") log(`== ${step.title} ==`);
      if (event === "skipped") log("  skipped (not enabled or no applicable input)");
    }
  });
}

function printProjectResult(project, flags, { report = false } = {}) {
  if (flags.json) return writeJson(project);
  if (report) {
    process.stdout.write(`${project.report.markdown || ""}${project.report.markdown?.endsWith("\n") ? "" : "\n"}`);
    return;
  }
  process.stdout.write(`${project.project.id}\n`);
}

export async function runProgrammatic(positional, flags) {
  const log = logger(flags.quiet);
  const [core, sourcesModule] = await Promise.all([
    import("../../tui/src/core.js"),
    import("../../tui/src/sources.js")
  ]);
  const application = core.application;
  await configure(application, flags);

  const detach = attachStream(core.streamBus, log);
  try {
    const known = new Set([
      "run", "new", "pipeline", "classify", "trace-model", "stride", "attack-trees",
      "coordination", "report", "projects", "status", "show", "export", "settings", "commands"
    ]);
    let command = positional[0];
    let rest = positional.slice(1);
    if (!command || !known.has(command)) {
      command = "run";
      rest = positional;
    }

    if (command === "commands") {
      const commands = [...application.COMMANDS];
      if (flags.json) writeJson(commands);
      else process.stdout.write(`${commands.join("\n")}\n`);
      return;
    }
    if (command === "settings") {
      const [settings, keyStatus] = await Promise.all([
        application.execute("settings.get"),
        application.execute("keystore.status")
      ]);
      writeJson({ settings, keyStatus });
      return;
    }
    if (command === "projects") {
      const projects = await application.execute("projects.list");
      if (flags.json) writeJson(projects);
      else if (!projects.length) process.stdout.write("(no projects)\n");
      else for (const project of projects) process.stdout.write(`${project.id}\t${project.updatedAt}\t${project.name}\n`);
      return;
    }

    const requireId = () => {
      if (!rest[0]) throw new Error(`Missing <projectId> for ${command}.`);
      return rest[0];
    };

    if (command === "show") {
      writeJson(await application.execute("projects.get", { id: requireId() }));
      return;
    }
    if (command === "status") {
      const status = statusOf(await application.execute("projects.get", { id: requireId() }));
      if (flags.json) writeJson(status);
      else {
        for (const [key, value] of Object.entries(status)) {
          process.stdout.write(`${key}\t${typeof value === "object" ? JSON.stringify(value) : value}\n`);
        }
      }
      return;
    }
    if (command === "export") {
      const project = await application.execute("projects.get", { id: requireId() });
      if (!project.report.markdown?.trim()) throw new Error("This project has no generated report.");
      process.stdout.write(`${project.report.markdown}${project.report.markdown.endsWith("\n") ? "" : "\n"}`);
      return;
    }
    if (command === "new" || command === "run") {
      if (command === "run" || flags.scope) await requireConfiguredProvider(application);
      const project = await createFromSources({ application, core, sourcesModule, args: rest, flags, log });
      log(`project ${project.project.id}`);
      if (command === "new") {
        printProjectResult(project, flags);
        return;
      }
      const result = await runFull(application, project.project.id, flags, log);
      printProjectResult(result.project, flags, { report: true });
      return;
    }
    if (command === "pipeline") {
      const id = requireId();
      const result = await runFull(application, id, flags, log);
      printProjectResult(result.project, flags, { report: true });
      return;
    }

    await requireConfiguredProvider(application);
    const id = requireId();
    const result = await application.runStep(id, command, {
      attackTreeLimit: positiveInt(flags.trees, 3)
    });
    if (!flags.quiet) log(`${result.step.title}: ${result.status}`);
    printProjectResult(result.project, flags, { report: command === "report" });
  } finally {
    detach();
  }
}
