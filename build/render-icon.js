"use strict";

// One-off: rasterize the app-icon SVG to a transparent PNG via Electron/Chromium
// (the CLI converters that preserve alpha aren't installed). Run: electron build/render-icon.js
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const SIZE = 1024;
const SVG = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "assets", "logo", "app-icon.svg"), "utf8");
const OUT = path.join(__dirname, "icon.png");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const html = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${SVG}`;
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    useContentSize: true,
    webPreferences: { offscreen: true }
  });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log("[render-icon] wrote", OUT, img.getSize());
  app.quit();
});
