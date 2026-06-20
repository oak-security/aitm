"use strict";

// One-off: render the README banner to docs/banner.png via Electron/Chromium so the
// BDO Grotesk text and gradient render exactly. Run: electron build/render-banner.js
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const W = 1280;
const H = 320;
const FONTS = path.join(__dirname, "..", "src", "renderer", "assets", "fonts");
const fontUrl = (f) => "file://" + path.join(FONTS, f).replace(/\\/g, "/");
const OUT = path.join(__dirname, "..", "docs", "banner.png");

const HTML = `<!doctype html><meta charset="utf-8">
<style>
  @font-face { font-family:"BDO Grotesk"; font-weight:800; src:url("${fontUrl("BDOGrotesk-Black.woff2")}") format("woff2"); }
  @font-face { font-family:"BDO Grotesk"; font-weight:500; src:url("${fontUrl("BDOGrotesk-Medium.woff2")}") format("woff2"); }
  html,body{margin:0;padding:0}
  .banner{width:${W}px;height:${H}px;background:#000;position:relative;display:flex;align-items:center;gap:44px;
    padding:0 76px;box-sizing:border-box;font-family:"BDO Grotesk",sans-serif;overflow:hidden}
  .accent{position:absolute;top:0;left:0;right:0;height:8px;background:linear-gradient(90deg,#FFC965 0%,#9C0069 100%)}
  .mark{width:150px;height:150px;flex:none}
  .title{font-weight:800;font-size:96px;line-height:.9;letter-spacing:-3px;color:#fff}
  .sub{font-weight:500;font-size:22px;letter-spacing:9px;text-transform:uppercase;color:#b6babf;margin-top:16px}
  .rule{height:6px;width:248px;border-radius:3px;margin-top:20px;background:linear-gradient(90deg,#FFC965 0%,#9C0069 100%)}
  .by{position:absolute;right:76px;bottom:30px;color:#6f747a;font-size:18px;letter-spacing:1px}
</style>
<div class="banner">
  <div class="accent"></div>
  <svg class="mark" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <g fill="none" stroke="#FFC965" stroke-width="22" stroke-linecap="round">
      <line x1="256" y1="206" x2="150" y2="356"/>
      <line x1="256" y1="206" x2="362" y2="356"/>
    </g>
    <circle cx="256" cy="158" r="50" fill="none" stroke="#FFC965" stroke-width="22"/>
    <circle cx="256" cy="158" r="13" fill="#FFC965"/>
    <circle cx="150" cy="366" r="34" fill="#FFC965"/>
    <circle cx="362" cy="366" r="34" fill="#FFC965"/>
  </svg>
  <div>
    <div class="title">AiTM</div>
    <div class="sub">AI Threat Modeller</div>
    <div class="rule"></div>
  </div>
  <div class="by">by Oak Security</div>
</div>`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true }
  });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(HTML));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log("[render-banner] wrote", OUT, img.getSize());
  app.quit();
});
