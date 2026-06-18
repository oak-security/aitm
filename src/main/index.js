"use strict";

const path = require("node:path");
const { app, BrowserWindow, Menu, shell, session, nativeImage } = require("electron");
const { registerIpc } = require("./ipc");

const isDev = process.argv.includes("--dev");
const RENDERER_DIR = path.join(__dirname, "..", "renderer");
// Bundled with the renderer assets so it resolves in both dev and packaged builds
// (build/ is buildResources for the installer/bundle icon, not shipped in app files).
const ICON_PNG = path.join(RENDERER_DIR, "assets", "logo", "app-icon.png");

// Menu-bar app name. The Cmd+Tab / app-chooser label is the bundle name and only
// becomes "AiTM" in a packaged build (npm run dist); in dev it stays "Electron".
app.setName("AiTM");

// Hosts the renderer is allowed to open externally. Everything else is blocked.
const EXTERNAL_HOST_ALLOWLIST = new Set([
  "github.com",
  "creativecommons.org",
  "platform.openai.com",
  "mostlyharmless.io"
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#FAF6EE",
    title: "AiTM",
    icon: ICON_PNG,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev
    }
  });

  // Block in-app navigation to any remote origin; the app is a single local page.
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) event.preventDefault();
  });

  // Route external links through the OS browser, allowlisted only. Deny new windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const host = new URL(url).hostname;
      if ((url.startsWith("https://")) && EXTERNAL_HOST_ALLOWLIST.has(host)) {
        shell.openExternal(url);
      }
    } catch {
      /* ignore malformed urls */
    }
    return { action: "deny" };
  });

  // Deny attaching webviews entirely.
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());

  win.loadFile(path.join(RENDERER_DIR, "index.html"));
  if (isDev) win.webContents.openDevTools({ mode: "detach" });
  return win;
}

function hardenSession() {
  // Strict CSP applied to the renderer. No remote script/style, no eval.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          // script-src is locked to 'self' (no inline/remote JS — the directive that
          // matters). style-src allows inline style attributes used for layout; this is
          // low-risk locally (no secrets in the DOM, no remote origins).
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
          "font-src 'self'; img-src 'self' data:; connect-src 'self'; " +
          "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        ]
      }
    });
  });

  // Renderer never needs device permissions.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      role: "viewMenu",
      submenu: isDev
        ? undefined
        : [
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" }
          ]
    },
    { role: "windowMenu" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Replace the default Electron dock icon during dev (macOS).
  if (process.platform === "darwin" && app.dock) {
    const img = nativeImage.createFromPath(ICON_PNG);
    if (!img.isEmpty()) app.dock.setIcon(img);
  }
  hardenSession();
  registerIpc();
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Smoke-test hook: boot, let the renderer load, then quit. No effect in normal use.
  if (process.env.AITM_SMOKE) {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.on("did-finish-load", () => console.log("[smoke] renderer loaded"));
    win.webContents.on("console-message", (_e, _lvl, msg, line, src) => console.log("[renderer]", msg, "@", src, "line", line));
    setTimeout(() => app.quit(), 4000);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Defense in depth: forbid creating additional renderers with unsafe prefs.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
