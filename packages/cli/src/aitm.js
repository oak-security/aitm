#!/usr/bin/env node
// One engine dispatcher, five explicit adapters over the same application module:
// TUI, Electron GUI, local web UI, headless CLI (-p), and API server (serve).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HELP, parseArgs, selectMode } from "./args.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function version() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
}

async function runTui(positional, flags) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The TUI needs an interactive terminal; use `aitm -p` for non-interactive output.");
  }
  const sourceArgs = positional.slice(1);
  const [{ resolveTargets }, { runTui: renderTui }] = await Promise.all([
    import("./tui/sources.js"),
    import("./tui/tui/index.js")
  ]);
  await renderTui({ targets: resolveTargets(sourceArgs), configure: Boolean(flags.configure) });
}

async function runGui(flags) {
  const configured = process.env.AITM_DESKTOP_EXECUTABLE;
  const command = configured || (process.platform === "darwin" ? "open" : null);
  if (!command) {
    throw new Error(
      "AiTM Desktop is a separate installation. Set AITM_DESKTOP_EXECUTABLE to its launcher, " +
        "or install the macOS app and run `aitm gui` there."
    );
  }
  const args = configured ? (flags.dev ? ["--dev"] : []) : ["-a", "AiTM"];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else if (signal) reject(new Error(`Electron GUI terminated by ${signal}.`));
      else reject(new Error(`Electron GUI exited with status ${code}.`));
    });
  });
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(HELP);
    return;
  }
  if (flags.version || positional[0] === "version") {
    process.stdout.write(`aitm ${version()}\n`);
    return;
  }
  if (flags.dataDir) process.env.AITM_DATA_DIR = path.resolve(flags.dataDir);
  if (flags.configDir) process.env.AITM_TUI_CONFIG_DIR = path.resolve(flags.configDir);

  const mode = selectMode(positional, flags);

  if (mode === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (mode === "gui") {
    await runGui(flags);
    return;
  }

  if (mode === "server" || mode === "web") {
    const extra = positional.slice(1);
    if (extra.length) throw new Error(`Unexpected argument for ${mode} mode: ${extra[0]}`);
    const { startServer } = await import("./server/start.js");
    await startServer({
      mode,
      port: flags.port,
      host: flags.host,
      allowedHosts: flags.allowedHosts
    });
    return;
  }
  if (mode === "print") {
    const { runProgrammatic } = await import("./programmatic.js");
    await runProgrammatic(positional, flags);
    return;
  }
  await runTui(positional, flags);
}

main().catch((error) => {
  process.stderr.write(`aitm: ${error.message}\n`);
  process.exitCode = 1;
});
