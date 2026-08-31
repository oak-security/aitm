# @oak-security/aitm

The non-Electron AiTM distribution. One executable selects an explicit adapter:

```text
aitm tui [source ...]
aitm -p [command ...]
aitm web
aitm serve
aitm gui
```

The first four modes run without Electron. `aitm gui` launches a separately installed
AiTM Desktop application (or `AITM_DESKTOP_EXECUTABLE`) rather than bundling Electron.
