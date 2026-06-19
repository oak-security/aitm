"use strict";

const { BrowserWindow } = require("electron");

// Push a streaming event to the renderer's AI console. Single-window app, so the
// first window is the target.
function emitStream(payload) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send("ai:stream", payload);
}

module.exports = { emitStream };
