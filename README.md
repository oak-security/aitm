# AiTM — AI Threat Modeller

Local-first desktop application for AI-assisted threat modeling using the
[TRACE](https://github.com/oak-security/TRACE) framework. Built with Electron.

- **Local-first**: projects and your encrypted API key live on your machine; nothing
  is uploaded except the AI calls you trigger.
- **Bring your own key**: OpenAI or Anthropic, stored encrypted via the OS keychain.
- **TRACE phases**: Scope & Sources → TRACE model → STRIDE → Attack trees →
  Collusion/Coordination → Report. Optional phases toggle per project.
- **Generic**: domain profiles span generic IT, web, cloud, mobile, ICS/OT, and Web3.

## Download & install

Get the latest installers from the **[Releases page](https://github.com/oak-security/aitm/releases/latest)**.
(This is a private repository — sign in to GitHub with an account in the `oak-security`
org to see them.)

You also need your **own AI API key** (OpenAI or Anthropic) — see "First run" below.

### macOS (Apple Silicon)

1. Download **`AiTM-<version>-arm64.dmg`**.
2. Open the `.dmg` and drag **AiTM** into **Applications**.
3. Launch it from Applications.

The macOS build is signed and notarized, so it opens with no Gatekeeper warning.
Note: **Apple Silicon (M-series) only** — Intel Macs aren't supported yet.

### Windows

1. Download **`AiTM-Setup-<version>.exe`** and run it.
2. The app isn't code-signed yet, so SmartScreen shows **"Windows protected your PC"**.
   Click **More info → Run anyway**.
3. Complete the installer and launch AiTM.

### Linux

- **AppImage** (any distro):
  ```sh
  chmod +x AiTM-<version>.AppImage
  ./AiTM-<version>.AppImage
  ```
- **Debian / Ubuntu** (`.deb`):
  ```sh
  sudo apt install ./aitm_<version>_amd64.deb
  ```

(Both are x86-64 / amd64.)

### First run

1. Open **Settings** (sidebar, bottom-left).
2. Choose your **provider** (OpenAI or Anthropic), paste your **API key**, and click **Test key**.
3. Click **New** to create a project, add sources, and start modeling — or use
   **Run full pipeline** on the Overview screen for an end-to-end first pass.

Your key is stored encrypted on your device (OS keychain) and is only ever sent to the
provider you select. Projects and settings live in your app-data folder ("Reveal data
folder" in the sidebar).

### Updates

Auto-update is not active yet, so check the [Releases page](https://github.com/oak-security/aitm/releases/latest)
for new versions and install over the top.

## Develop

```sh
npm install
npm run dev        # launch with devtools
npm start          # launch
npm run check      # syntax check
npm test           # unit tests
```

## Build installers

```sh
npm run dist        # current platform
npm run dist:mac    # macOS .dmg + .zip
npm run dist:win    # Windows NSIS
npm run dist:linux  # AppImage + .deb
```

macOS signing & notarization auto-enable when `APPLE_TEAM_ID` (and notarization
credentials) are present in the environment — see [electron-builder.js](electron-builder.js).
Plain `npm run dist` produces an unsigned local build.

## Release (CI)

Pushing a `v*` tag runs [.github/workflows/release.yml](.github/workflows/release.yml):
it builds the macOS/Windows/Linux matrix and publishes the installers to a (draft)
GitHub Release. Set these repo secrets for a signed + notarized macOS build (all
optional; without them the mac build is unsigned):

| Secret | Meaning |
| --- | --- |
| `MAC_CSC_LINK` | base64 of the Developer ID Application `.p12` |
| `MAC_CSC_KEY_PASSWORD` | password for that `.p12` |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | team id (e.g. `V863M8NPN9`); also enables notarization |

```sh
git tag v0.1.0 && git push origin v0.1.0
```

Export the cert for `MAC_CSC_LINK`: `base64 -i DeveloperID.p12 | pbcopy`.

## Auto-update

The app checks GitHub Releases on launch via `electron-updater` (packaged builds only).
Because this repo is **private**, release assets are not anonymously downloadable, so
auto-update is a no-op until one of:

- the repo (or a release mirror) is made public, or
- a public update feed is used instead (point `publish` in `electron-builder.js` at a
  `generic` provider — e.g. an R2/S3 bucket — and upload the `latest*.yml` + installers).

Until then, distribute by handing out the installer; the updater fails quietly.

## Documentation

- [AGENT.md](AGENT.md) — build/run conventions and the security/branding invariants.
- [SPEC.md](SPEC.md) — product and technical specification.

## Data location

`~/Library/Application Support/AiTM` (macOS), `%APPDATA%\AiTM` (Windows),
`~/.config/AiTM` (Linux): `projects/*.json`, `settings.json`, and the encrypted
`keystore.bin`. The in-app sidebar has a "Reveal data folder" link.

## License

Proprietary. All rights reserved.
