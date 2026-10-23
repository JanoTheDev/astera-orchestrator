# Security audit (2026-10-17, upstream v1.4.14 @ 137b18a4)

Read-only audit done before anything was installed or run. Two passes: source code, and the dependency
supply chain.

## Verdict: clean (no malicious code found, ~85–90% confidence)

- No telemetry, analytics, obfuscation, or hidden egress.
- **Rule since T27: no telemetry; crash reports only with consent per report.** Crashes of the main process, a
  window and the Host are written as redacted reports to `<userData>/crash-reports/` (dir 700, files 600, at most
  20 kept, none past 30 days): the error's name and stack frames, never its message, with tokens, keys, emails,
  home paths and query strings removed (`src/core/crash/redact.ts`). The app makes no network request for them.
  Each report is shown to the person in full, and only **Send** opens a prefilled issue on
  `github.com/JanoTheDev/astera-orchestrator` in their browser, where they can still edit or drop it. Settings
  `crashReports: "never"` stops the prompt. Why: a crash on someone else's machine is otherwise invisible to us,
  and a report that is read, redacted and sent by its owner's choice gives us the frame without taking anything
  they did not see.
- No committed binaries (`.node`/ELF/PE/`.so`/`.wasm`/archives) in 1996 files or anywhere in history.
- `new Function` / `Worker eval:true` only in `src/host/workspace/scriptWorker.ts`. It runs a fixed in-file
  sandbox source.
- 3475 commits by one author. History is consistent, with no injected obfuscated commits.
- Lockfile: all 844 `resolved` URLs point to `registry.npmjs.org`, and every entry has `integrity`. No git
  or tarball dependencies.
- Install-time scripts, all legit:
  - root `postinstall` → `electron-builder install-app-deps`
  - `electron`: downloads its binary
  - `esbuild`
  - `node-pty`: compiled from source on Linux
  - `electron-winstaller`, `fsevents`: no-ops on Linux

## External hosts contacted

| Host | Why |
|---|---|
| `api.anthropic.com/api/oauth/usage` | Usage %. The OAuth token goes only to Anthropic (`src/core/usage/rateLimitFetcher.ts`). |
| `chatgpt.com/backend-api/wham/usage` | Codex usage. The token goes only to OpenAI (`src/main/codexUsage.ts`). |
| `claude.ai/install.sh`, `chatgpt.com/codex/install.sh` | Only when you press **Install CLI** (`src/core/install/cliInstall.ts`). |
| `github.com/parsingk/Astera/releases` + remote `policy.json` | Auto-update and a remote version kill switch. **Disabled in this fork (Wave 0).** |
| Slack API | Only if you configure a Slack bot. |
| `registry.npmjs.org` | Plugin installer. sha512 pinned. |

## Risky by design (not malicious) — fork decisions

| # | Item | Fork decision |
|---|---|---|
| 1 | Auto-update downloads upstream releases automatically (`src/main/index.ts` autoUpdater, `electron-builder.yml` publish, `src/main/updatePolicy.ts`). It would replace this fork's build, and upstream `policy.json` can block versions. | **Disable** auto-update and the remote policy fetch (Wave 0). Pull upstream changes manually with `git fetch upstream`. |
| 2 | Chat sessions can run with `--permission-mode bypassPermissions` (`src/core/chat/claudeProtocol.ts`). Opt-in. | Keep it off. Orchestrator workers must not turn it on by default. |
| 3 | Slack replies are typed into live sessions. Allow-listed to one Member ID and channel. | Leave Slack off unless needed. |
| 4 | MCP HTTP server on :7871, off by default, bearer token. Has a "lan" option. | Keep it local only. |
| 5 | Remote runtime gateway on 127.0.0.1:47831, off by default. TLS with a pinned cert and pairing. | Never bind it to 0.0.0.0. |
| 6 | Main window uses `sandbox: false, webviewTag: true`. | Accepted for now. Revisit after the Electron bump. |

## Dependency advisories (`npm audit --package-lock-only`)

- 0 critical, 11 high, 11 moderate.
- Runtime-relevant:
  - `electron` 41.7.1 → **≥ 41.10.6**
  - `undici` 7.29.0 → **≥ 7.30**
- The rest are build or dev-time only: `extract-zip`, `@xmldom/xmldom`, `js-yaml`, `brace-expansion`, etc.
- The bumps happen in Wave 0.

## Before first run

- Back up `~/.claude*`, `~/.claude.json`, `~/.codex`, and your shell rc files. The app reads and writes
  account config dirs by design.
- Linux build needs: `build-essential python3 git curl xz-utils`, and Node ≥ 22.13.
- Run from source with `npm run dev`. That path never auto-updates.
