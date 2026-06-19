"use strict";

// electron-builder configuration (takes precedence over any package.json "build" field).
//
// macOS signing & notarization are gated on the environment so a plain local
// `npm run dist` stays fast and unsigned, while a release build turns both on:
//
//   - Signing: electron-builder auto-discovers a "Developer ID Application"
//     certificate in the login keychain (CSC_IDENTITY_AUTO_DISCOVERY, default on).
//     In CI, provide the cert as base64 via CSC_LINK + CSC_KEY_PASSWORD instead.
//   - Notarization: enabled when APPLE_TEAM_ID is set. Credentials come from env:
//       Apple ID method:  APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
//       API-key method:   APPLE_API_KEY (path to .p8), APPLE_API_KEY_ID, APPLE_API_ISSUER (+ APPLE_TEAM_ID)
//
// Release:  APPLE_TEAM_ID=XXXXXXXXXX APPLE_ID=you@... APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx npm run dist:mac

const notarize = process.env.APPLE_TEAM_ID ? { teamId: process.env.APPLE_TEAM_ID } : false;

module.exports = {
  appId: "io.oaksecurity.aitm",
  productName: "AiTM",
  directories: { buildResources: "build", output: "dist" },
  // Publish target for `electron-builder --publish` and the feed electron-updater reads.
  // The repo is private, so silent auto-update requires the runtime to authenticate
  // (a GH token) or the release assets to be public — see README "Auto-update".
  publish: [{ provider: "github", owner: "oak-security", repo: "aitm" }],
  files: [
    "src/**/*",
    "package.json",
    "!**/*.map"
  ],
  mac: {
    category: "public.app-category.developer-tools",
    target: ["dmg", "zip"],
    icon: "build/icon.icns",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    notarize
  },
  dmg: {
    title: "AiTM ${version}"
  },
  win: {
    target: ["nsis"],
    icon: "build/icon.png"
  },
  linux: {
    target: ["AppImage", "deb"],
    category: "Development",
    icon: "build/icon.png"
  }
};
