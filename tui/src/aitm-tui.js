#!/usr/bin/env node
// aitm-tui — terminal frontend for AiTM (AI Threat Modeller, TRACE framework).
// Sources: file paths, directories, or a git/GitHub URL; no arguments = cwd.
import { resolveTargets } from "./sources.js";

const HELP = `aitm-tui — AI Threat Modeller (TRACE) terminal UI

Usage:
  aitm-tui [options] [source ...]

Sources (any mix; default: current directory):
  <dir>                 ingest a directory tree (code and/or docs)
  <file> [...]          ingest specific files (.md .txt .docx .pdf + source files)
  <git url>             shallow-clone and ingest a repository

Options:
  -c, --configure       re-run provider/key/model setup
  -h, --help            show this help
  -V, --version         show version

Keys are read from OPENAI_API_KEY / ANTHROPIC_API_KEY, else from the TUI key file.
Projects are stored in the AiTM desktop app's project store and open there too.
`;

function main() {
  const args = process.argv.slice(2);
  const targets = [];
  let configure = false;
  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(HELP);
      return;
    }
    if (arg === "-V" || arg === "--version") {
      process.stdout.write("aitm-tui 0.1.0\n");
      return;
    }
    if (arg === "-c" || arg === "--configure") {
      configure = true;
      continue;
    }
    if (arg.startsWith("-")) {
      process.stderr.write(`Unknown option: ${arg}\n\n${HELP}`);
      process.exitCode = 2;
      return;
    }
    targets.push(arg);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("aitm-tui needs an interactive terminal (TTY).\n");
    process.exitCode = 1;
    return;
  }

  let resolved;
  try {
    resolved = resolveTargets(targets);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  import("./tui/index.js")
    .then(({ runTui }) => runTui({ targets: resolved, configure }))
    .catch((err) => {
      process.stderr.write(`${err.stack || err.message}\n`);
      process.exitCode = 1;
    });
}

main();
