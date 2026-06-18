# AiTM — AI Threat Modeller

Local-first desktop application for AI-assisted threat modeling using the
[TRACE](https://github.com/oak-security/TRACE) framework. Built with Electron.

- **Local-first**: projects and your encrypted API key live on your machine; nothing
  is uploaded except the AI calls you trigger.
- **Bring your own key**: OpenAI or Anthropic, stored encrypted via the OS keychain.
- **TRACE phases**: Scope & Sources → TRACE model → STRIDE → Attack trees →
  Collusion/Coordination → Report. Optional phases toggle per project.
- **Generic**: domain profiles span generic IT, web, cloud, mobile, ICS/OT, and Web3.

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

## Documentation

- [AGENT.md](AGENT.md) — build/run conventions and the security/branding invariants.
- [SPEC.md](SPEC.md) — product and technical specification.
- [PLAN.md](PLAN.md) — implementation milestones.

## Data location

`~/Library/Application Support/AiTM` (macOS), `%APPDATA%\AiTM` (Windows),
`~/.config/AiTM` (Linux): `projects/*.json`, `settings.json`, and the encrypted
`keystore.bin`. The in-app sidebar has a "Reveal data folder" link.

## License

Proprietary. All rights reserved.
