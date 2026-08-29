// Shared listener bootstrap for `aitm web`, `aitm serve`, and the legacy aitm-web entry.
// API server mode is intentionally API-only; web mode adds the browser renderer.
import { createWebServer } from "./server.js";
import { userDataDir } from "./shim.js";

function intValue(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : fallback;
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveServerOptions({ mode = "web", port, host, allowedHosts } = {}) {
  const prefix = mode === "server" ? "AITM_SERVER" : "AITM_WEB";
  const resolvedHost = host || process.env[`${prefix}_HOST`] || "127.0.0.1";
  const loopback = ["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"].includes(resolvedHost);
  const configuredHosts = allowedHosts === undefined
    ? csv(process.env[`${prefix}_ALLOWED_HOSTS`])
    : Array.isArray(allowedHosts) ? allowedHosts : csv(allowedHosts);
  return {
    mode,
    port: intValue(port ?? process.env[`${prefix}_PORT`], 8790),
    host: resolvedHost,
    allowedHosts: [...configuredHosts, ...(loopback ? [] : [resolvedHost])],
    loopback
  };
}

export async function startServer(options = {}) {
  const config = resolveServerOptions(options);
  const server = createWebServer({
    allowedHosts: config.allowedHosts,
    serveUi: config.mode === "web"
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });

  const label = config.mode === "web" ? "aitm web" : "aitm API server";
  console.log(`${label} listening on http://${config.host}:${config.port}`);
  if (config.mode === "web") console.log(`web UI: http://${config.host}:${config.port}/`);
  console.log(`health: http://${config.host}:${config.port}/api/healthz`);
  console.log(`data dir: ${userDataDir()}`);
  if (config.allowedHosts.length) console.log(`also answers to: ${config.allowedHosts.join(", ")}`);
  if (!config.loopback) {
    console.warn(
      `WARNING: bound to ${config.host}, which is not loopback. AiTM has no built-in authentication — ` +
        "anyone who can reach this port has full access to your projects and API keys."
    );
  }
  return { server, config };
}
