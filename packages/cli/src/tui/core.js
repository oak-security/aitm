// Compatibility facade for the TUI implementation. The actual runtime is constructed
// by the CLI package and crosses the engine's supported interface; no Electron shim.
export * from "../runtime.js";
