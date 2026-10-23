# Known limits

What Astera does not do, does not yet do well, or has not been checked on. Read this before you promise anything.
Every item says where it comes from. Items marked **open** are not fixed on this branch.

## Platforms

| Platform | Status | Evidence |
| --- | --- | --- |
| Linux (Ubuntu 24.04, XFCE on X11) | **Verified** by hand, on a dev build and packaged AppImage | `docs/dev/LINUX.md` (runs of 2026-10-17 and 2026-10-18) |
| Linux, Ubuntu 22.04 / Debian 12 | Supported floor, enforced by the package build and `libc6 (>= 2.35)` in the deb | `knowledge/decisions/ADR-001-linux-support-floor.md` |
| Linux, Wayland | **Not verified.** Every check ran on X11. | `docs/dev/LINUX.md` “Closing the window” |
| Linux, Ubuntu 20.04 and Debian 11 | **Not supported.** apt refuses the deb. | ADR-001 |
| Windows | **Built, not verified** on a real machine. Release builds and a signing step exist; signing ships unsigned without its secrets. | `docs/releasing.md` |
| macOS | **Built, not verified** on a real machine. Signing and notarization need Apple secrets; without them the build ships unsigned. | `docs/releasing.md` |

Do not claim that Astera runs on Windows or macOS until someone has run a full plan on that OS and recorded it.

## Required tools and accounts

- **git** is required. Worktrees and delivery depend on it.
- **Claude Code** (`claude`) and/or **Codex CLI** (`codex`) are required for agent sessions. Without them the app starts
  in onboarding, shows a banner, and disables Start. Onboarding can install them from the vendors' installers.
- **gh** (GitHub CLI) is needed for pull requests and issue links. Without it, the app works but cannot open a PR.
- **Node 22.13 or newer** is needed only to build from source. Packaged builds do not need it.
- **Accounts**: every agent runs on an account you own and sign in to (Claude or ChatGPT/Codex). Astera does not
  provide accounts, model access or billing.
- A **Linux build from source** compiles `node-pty` on your machine (needs `python3`, `make`, `g++`).

Source: `docs/dev/LINUX.md` “Prerequisites” and “First run on a clean machine”.

## Agents and permissions

- **Agents stop at permission prompts.** By default, a worker or the coordinator waits for you when Claude asks
  permission. It shows “waiting for permission” in the Agents wall and the Inbox. Turning this off is the explicit
  setting **Run agents without permission checks** (Settings › Agents). It is off by default.
- Agents never approve a plan or answer a permission prompt. Only you do.
- Agents do not switch accounts beyond account rolling, and only when you have enabled it.

## Usage limits and rate limits

- Limits come from **your own accounts**. Astera cannot raise them.
- A worker does not start on an account at or over its limit (default 90%, Settings). It waits or starts on another account.
- Account rolling resumes work on the next account when a session hits a limit. Work can still stop if every account is at its limit.
- Usage meters read each vendor's usage endpoint with your login (see Network below).

## Network use

Astera has no relay or cloud service of its own. Outbound traffic happens only in these cases:

| Who | When | What is sent |
| --- | --- | --- |
| Claude and Codex CLIs | Every agent session | Prompts and code, to the vendor, under your account |
| Usage meters | While the app shows usage | A request to the vendor's usage endpoint (`api.anthropic.com`, `chatgpt.com`) with your login |
| GitHub, via `gh` and `git` | Issues, PRs, checks, pushes you start | Repository data, under your GitHub login |
| Update check, release builds | At startup and periodically | A request to GitHub Releases (`electron-updater`); downloads the update when found |
| Update check, source builds | Every 30 minutes | A git fetch of `origin/main` of your checkout |
| npm registry | Installing a plugin | Package download |
| Telegram, if you set up the bot | Its messages | `api.telegram.org` |
| CLI installers | When you press Install in onboarding or Tools | Runs the vendor's install script (`curl … | bash` or `irm … | iex`) |
| Remote runtimes, if you pair one | Its sessions | Traffic to the machine you named, over your LAN, VPN or Tailscale |

Crash reports send nothing on their own. **Send** opens a GitHub issue in your browser with the report filled in; you
submit it.

Local only: plans, Tasks, sessions, worktrees, files, Local History, settings and usage cache, in the app's profile
folder. Nothing is uploaded from there by the app.

Not verified in this pass: when the git-ai install command in `src/core/attribution/gitAi.ts` runs, and whether it
needs your confirmation. Check before you sell an offline or no-install promise.

## Features that are partial or not yet proven

- **Export.** There is no export feature. Plans, files and sessions live on disk; “Copy” and “Copy details” copy text
  to the clipboard. Do not sell export.
- **Licensing.** None. The About row says “Personal build” and nothing is checked. See [licensing.md](licensing.md).
- **Voice input** uses a local whisper.cpp binary and model you provide. Nothing is downloaded for you.
- **Plugins, MCP, Slack, Telegram, Remote runtimes, Higgsfield and the creative hub** have settings pages and setup docs.
  Their end-to-end behaviour on the branch was not re-checked in this pass.
- **Source-build updates** exist only for builds made from a git checkout.

## Reason lines are English

Reason lines that the Host or an agent writes are shown **as written, in English**, not translated. This covers
the decided, refused, recovered and escalation texts, and the question and answer texts, in the Inbox and the bell.

- The sentence around the text is translated. The text itself is inserted as it was written. Example: the feed
  template in `src/renderer/src/components/activity/activityView.ts` (`lineOf`) puts `p.reason`, `p.question`,
  `p.answer`, `p.summary` and `p.error` into translated templates unchanged.
- A recovery Gate's question is composed in your language, but the reason inside it is the English one the decision
  table recorded (`reviewQuestion` in `src/core/recovery/execute.ts`).

Who to blame: the agent or the Host wrote that line in English. Astera does not translate agent output.

## Open defects and gaps

These come from the W12 screen notes (`docs/dev/shots/w12-*/NOTES.md`) and `docs/dev/shots/w12-after/REPORT.md`, plus
the current code. The W12 “Left” items for the kanban board, New task form, plan name and stale project are fixed in
`docs/dev/shots/w12-leftovers/NOTES.md` and are not listed.

There is no `docs/dev/shots/w12-all/NOTES.md` on this branch. The W12 notes are the per-screen files listed above.

| # | Gap | Where | Status |
| --- | --- | --- | --- |
| 1 | The Edit button in the history record pane only says “not ready yet”. | `docs/dev/shots/w12-history/NOTES.md` | **open** |
| 2 | Destructive row actions (plugin Remove, Higgsfield Remove, remote Remove and Revoke) are always visible, not on hover or in a menu. Kept on purpose. | `docs/dev/shots/w12-integrations/NOTES.md` | open, by choice |
| 3 | Local History is only in the Files right-click menu; there is no toolbar entry. | `docs/dev/shots/w12-files/NOTES.md` | **open** |
| 4 | Some icons are imported straight from lucide, not through the app's icon registry (Agents, Worktrees, Files, Settings). Visual only. | `docs/dev/shots/w12-agents`, `w12-worktrees`, `w12-files`, `w12-settings` | open, internal |
| 5 | The Open source licenses text breaks twice where the source file has hard line breaks. Readable. | `docs/dev/shots/w12-about/NOTES.md` | open |
| 6 | The plan header holds six or more ghost buttons; “Its consoles” could move into More. | `docs/dev/shots/w12-plan/NOTES.md` | open, needs owner decision |
| 7 | Worktree PR and push badges are still raw buttons with glyphs. | `docs/dev/shots/w12-worktrees/NOTES.md` | **open** (accessibility) |
| 8 | Ctrl+Shift+A and Ctrl+Shift+J did not open the history and jobs sidebars in the pre-redesign shots. Not re-checked after the redesign. | `docs/dev/shots/w12-before/NOTES.md` | open, re-check |
| 9 | Dev runs only: the Host inherits the DevTools port, so a relaunch on the same port fails until the Host ends. | `docs/dev/LINUX.md` known issue 3 | dev only |
| 10 | Electron logs `vaInitialize failed` on nouveau GPUs. Harmless. | `docs/dev/LINUX.md` known issue 4 | known |
| 11 | The native folder picker cannot be driven by automated checks; desktop e2e needs Xvfb and xdotool. | `docs/dev/LINUX.md` known issue 5 | known |
| 12 | Dogfood runs of 2026-10-18 recorded issues: a session started with `astera sessions create` counts as open only after a click; a replan opened a false owner Gate with a chime. Status not re-verified. | `docs/dev/LINUX.md` lines 317 and 355 | open, unverified |
| 13 | Reason lines are English (see above). | This page | by design, for now |
| 14 | Windows and macOS are not verified (see Platforms). | `docs/releasing.md` | open |

Some items may already be fixed in code that changed after these notes. Check before you quote one as current.

## What this page does not cover

- Pricing and the paid tier. The tags in [features.md](features.md) are suggestions.
- Vendor limits, prices and model access. Those belong to Anthropic and OpenAI and change without notice.
