const BOOLEAN_FLAGS = new Set(["print", "help", "version", "quiet", "json", "reset", "configure", "dev"]);
const VALUE_FLAGS = new Set([
  "port",
  "host",
  "allowedHosts",
  "dataDir",
  "configDir",
  "name",
  "scope",
  "provider",
  "modelFast",
  "modelDeep",
  "trees"
]);
const SHORT_FLAGS = {
  "-p": "print",
  "-h": "help",
  "-V": "version",
  "-q": "quiet",
  "-c": "configure"
};

function flagName(raw) {
  return raw.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

export function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (SHORT_FLAGS[arg]) {
      flags[SHORT_FLAGS[arg]] = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      if (arg.startsWith("-") && arg !== "-") throw new Error(`Unknown option: ${arg}`);
      positional.push(arg);
      continue;
    }

    const equals = arg.indexOf("=");
    const name = flagName(equals === -1 ? arg.slice(2) : arg.slice(2, equals));
    if (BOOLEAN_FLAGS.has(name)) {
      if (equals !== -1) throw new Error(`Option --${arg.slice(2, equals)} does not take a value.`);
      flags[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new Error(`Unknown option: --${arg.slice(2).split("=", 1)[0]}`);
    const value = equals === -1 ? args[++index] : arg.slice(equals + 1);
    if (value === undefined || value === "") throw new Error(`Missing value for --${arg.slice(2).split("=", 1)[0]}.`);
    flags[name] = value;
  }
  return { positional, flags };
}

const STARTUP_MODES = new Set(["tui", "gui", "web", "serve"]);

export function selectMode(positional, flags) {
  if (flags.print) {
    if (STARTUP_MODES.has(positional[0])) {
      throw new Error(`Choose one startup mode: -p or ${positional[0]}.`);
    }
    return "print";
  }
  if (!positional.length) return "help";
  if (positional[0] === "serve") return "server";
  if (STARTUP_MODES.has(positional[0])) return positional[0];
  throw new Error(`Unknown startup mode: ${positional[0]}. Use tui, gui, web, -p, or serve.`);
}

export const HELP = `AiTM — AI Threat Modeller

Usage:
  aitm tui [source ...]             interactive terminal UI
  aitm gui                          Electron desktop UI
  aitm web [options]                local browser UI plus HTTP/SSE API
  aitm -p [command ...]            programmatic, in-process command line
  aitm serve [options]             API-only HTTP/SSE server

Programmatic commands:
  aitm -p [source ...]             ingest sources, run the full pipeline, print report
  aitm -p run [source ...]         same as above
  aitm -p new [source ...]         ingest sources and print the new project id
  aitm -p pipeline <projectId>     run the full pipeline for an existing project
  aitm -p classify|trace-model|stride|attack-trees|coordination|report <projectId>
  aitm -p projects                 list stored projects
  aitm -p status <projectId>       print a project summary
  aitm -p show <projectId>         print the complete project JSON
  aitm -p export <projectId>       print the generated Markdown report
  aitm -p settings                 print settings and redacted key status
  aitm -p commands                 list application commands exposed by server mode

Options:
  --name <name>                    project name for -p run/new
  --scope <text>                   in-scope hint; also narrows directory ingestion
  --trees <n>                      maximum attack trees in automatic runs (default 3)
  --provider <id>                  openai or anthropic
  --model-fast <id>                fast model setting for this and future runs
  --model-deep <id>                deep model setting for this and future runs
  --json                           emit JSON from programmatic commands
  --reset                          reset derived analysis before -p pipeline
  -q, --quiet                      suppress progress on stderr
  --data-dir <path>                override the shared project/settings directory
  --config-dir <path>              override the non-Electron key directory
  --port <n>                       web/server port (default 8790)
  --host <address>                 web/server bind address (default 127.0.0.1)
  --allowed-hosts <a,b>            additional accepted Host header names
  -c, --configure                  rerun TUI provider/model setup
  --dev                            open Electron devtools in gui mode
  -h, --help                       show help
  -V, --version                    show version

Provider keys come from OPENAI_API_KEY / ANTHROPIC_API_KEY or the non-Electron
key file. Server mode is single-user and unauthenticated; keep it on loopback or
place it behind an authenticated tunnel/proxy.
`;
