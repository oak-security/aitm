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

## Usage guide

AiTM implements the [TRACE](https://github.com/oak-security/TRACE) threat-modeling
methodology: ingest what describes the system, build a structured model of it, enumerate
threats with STRIDE, optionally decompose the important ones into attack trees and check
for actor collusion, then produce a report. Every AI output is an **editable draft** — you
review and correct it; the app is an assistant, not an oracle.

### 1. Ingest your sources

On the **Sources & Scope** page (TRACE phases 0–1):

- **Add folder** — a local source/project directory (code, configs, docs). The walk is
  confined to the folder, honors `.gitignore`, and skips binaries/dependency dirs.
- **Add file** — individual files: specification / architecture / whitepaper documents
  (`.md`, `.txt`, `.pdf`, `.docx`) and/or source files.

Add **as many sources as you like** — they're complementary. A typical setup is a
**spec or whitepaper plus the code repo**. Everything is local; nothing is uploaded
until you run an AI step. Then (optionally) fill in **Scope** — boundaries, in/out of
scope, assumptions — and click **Ingest** to classify the system and open the Overview.

### 2. Tip: a good spec beats raw code

TRACE is a **design-level** methodology, so the model reasons best from material that
describes the system's **architecture, components, trust boundaries, assets, and
actors** — i.e. a clear **specification, whitepaper, or design doc**. Pointing it only at
a large code repository tends to produce noisier, lower-altitude results, because the
design intent has to be inferred from implementation detail. **Best results: feed it a
solid spec/whitepaper, and add the code as a supporting source** for grounding.

### 3. Two ways to run it

- **Full pipeline ("Run full pipeline" on the Overview)** — the "I'm feeling lucky" mode.
  Runs every enabled phase end to end (classify → TRACE model → STRIDE → top-3 attack
  trees → coordination → report), auto-approving each step. Great for a fast first pass
  or to scope effort. It **resets prior AI results** first, so it's a clean re-run.
- **Deliberate, phase by phase (recommended for real work)** — generate one phase at a
  time, **review and edit** the tables (assets, actors, invariants, threats, …), mark the
  phase reviewed, then move on. Correcting the TRACE model *before* STRIDE, and STRIDE
  *before* attack trees, materially improves the result. This is the approval-gate
  workflow; the full pipeline just auto-approves those same gates.

A good rhythm: run the full pipeline once for a draft, then walk the phases to refine.

### 4. The TRACE phases

Each phase is in the left nav; **optional ones can be toggled per project** under
**Phases** (disabled phases drop out of the workflow, the pipeline, and the report).

| Phase | What it does |
| --- | --- |
| **0–1 Sources & Scope** | Ingest local sources; record assessment boundaries. |
| **2 TRACE Model** | Structured model: protected assets, threat actors, privileged roles, invariants, components, trust boundaries, value/data flows. |
| **3 STRIDE** | Per-surface threats (Spoofing/Tampering/Repudiation/Info-disclosure/DoS/Elevation) with likelihood, impact, and risk. |
| **4 Attack Trees** *(optional)* | Decompose chosen threats into attack paths — one tree per threat, accumulative. |
| **5 Collusion & Coordination** *(optional)* | Where distinct actor groups (validators, multisig signers, committees, DAOs…) could coordinate to cause harm. Defaults on only when the classification flags it. |
| **6 Report** | Assembles the reviewed model into a design-level report; export to **PDF** or **Markdown**. |

The report is an **AI-assisted, design-level** document — it is not a code audit,
penetration test, or certification, and should be reviewed by an expert before external
use.

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
