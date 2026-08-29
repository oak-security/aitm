// HTTP adapter for the transport-neutral application command interface. Native-dialog
// commands remain Electron-only; browser upload and report-download routes live in
// server.js because they transfer files rather than application command payloads.
import * as core from "./core.js";

export function buildHandlers() {
  const handlers = Object.create(null);
  for (const command of core.application.COMMANDS) {
    handlers[command] = (payload) => core.application.execute(command, payload);
  }
  return handlers;
}
