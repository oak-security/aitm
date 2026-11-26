# Security policy

## Report a vulnerability

Open a private security advisory in this repository on GitHub (Security →
Report a vulnerability). Do not open a public issue for a vulnerability.
Include the version (`aitm --version`), the steps to reproduce, and the impact.

Only the latest release gets security fixes.

## Security model

AiTM is a local, single-user tool. It reads source material that you select and
sends it to the AI provider that you select when you start a run.

- **Network.** The server binds only to loopback. It rejects requests whose
  `Host`, `Origin` or fetch metadata do not match its own address, which stops
  cross-site requests and DNS rebinding.
- **Access token.** Each API request needs a random 256-bit token, as a bearer
  token or as an `HttpOnly`, `SameSite=Strict` cookie. The token is saved in
  `~/.config/aitm/token` with mode 600. This stops other users and processes of
  the same host from using your instance. Source import reads local paths, so an
  open loopback API would expose your files.
- **Credentials.** Provider keys are stored in plaintext files that only your OS
  user can read. They are not encrypted. AiTM refuses a credential file that
  other users can read, never returns a key through the API, and redacts keys
  from errors and output.
- **Sources.** Ingestion is bounded. It skips symlinks, credential files and
  dependencies, validates archive paths, and never executes source code or Git
  hooks. The workbench renders source and model text as inert text.
- **Model output.** Source text is evidence, never instructions. A model can
  still be wrong or be influenced by hostile source content. Each output is a
  draft until a person reviews it.

## Out of scope

- An attacker who already runs code as your OS user. That attacker can read the
  token and key files.
- The data handling of the AI provider that you select.
- The correctness of AI analysis. Citations make claims traceable; they do not
  make them true.

## Known limits

- The launch URL contains the access token. It appears in the terminal and can
  appear in the browser history. Do not share it. `aitm token --rotate` replaces
  the token.
- Browsers scope cookies by host and not by port. Another service on
  `127.0.0.1`, opened in the same browser, can receive the cookie.
