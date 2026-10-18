# Linux — source of truth for this fork

Verified 2026-10-17 by Wave 0 on Ubuntu 24.04 (kernel 6.14), XFCE on X11, Node 24.22.0, npm 11.19.1.
Code is cited by symbol (ADR-005). Later waves: update this file when you learn something new about Linux.

## Prerequisites

| Tool | Needed | Checked with |
|---|---|---|
| Node | ≥ 22.13 (`package.json` `engines`) | `node -v` |
| python3, make, g++ | node-pty is compiled from source by `postinstall` | `python3 --version; make --version; g++ --version` |
| git | worktrees, tests | `git --version` |
| `claude` CLI | Claude sessions (optional for plain terminals) | `which claude` |
| `gh` | PRs | `which gh` |

If something is missing: `sudo apt install build-essential python3 git curl xz-utils`.

Before the first run, back up `~/.claude`, `~/.claude.json`, `~/.codex` and your shell rc files. The app reads and
writes account config dirs by design (SECURITY-AUDIT.md).

## Commands

```bash
git worktree add ../astera-wt/<slug> -b <branch> origin/main && cd ../astera-wt/<slug>
npm ci                        # ~20 s; postinstall builds node-pty against Electron
npm run typecheck
npx vitest run --maxWorkers=2 # see "Load" below; the full suite is ~850 files
npm run dev                   # dev app; userData is ~/.config/Astera-dev, never auto-updates
npm run dist:linux            # AppImage + deb in dist-installer/
```

### Load: don't crash the machine

The full suite spawns many git/node/Electron processes. `vitest.config.ts` uses `workersFor(cores)` (half the cores
above 4). On a laptop, run it with `--maxWorkers=2`. Never run the suite at the same time as `npm run dev` or
`dist:linux`. Wave 0 ran all three at once and crashed the laptop.

## What works (verified by hand in Wave 0)

- `npm ci`, `npm run typecheck`: clean.
- `npm test`: 845 files / 14 813 tests pass, 0 fail (after the fixes below).
- `npm run dev`: the window opens, and the account and its usage bars are detected.
- **Bottom terminal panel**: a bash PTY spawns. Typed input runs (`echo`, `uname`).
- **Claude session** (New session → Terminal): `claude` spawns inside the **Host** process (`out/main/host.js`),
  not the app, and accepts typed input. The "Run without permission checks" box is unchecked by default.
- **Close and reopen**: on Linux, closing the window quits the app. There is no tray: `createTray` is skipped on Linux
  in `src/main/index.ts`. A dialog says running sessions keep running. The Host and the `claude` PTY survive. On
  reopen the tab reattaches to the same process, and the unsent input is still there.
- "End the kept sessions too" in that dialog ends the Host and its PTYs.

## Fixed in Wave 0

| Problem on Linux | Root cause | Fix |
|---|---|---|
| 19 plugin-secret tests failed. Plugin secrets would fail on any real Ubuntu install too | Ubuntu's default umask 002 makes dirs 775. `openSecretStore` → `createDir` made parent dirs with the default mode, and `posixProblem` then refused them as group-writable | `createDir` makes parents with `mode: 0o700`. `openPluginSecrets` (`src/host/plugins/pluginData.ts`) walks only up to `plugins/`, not the profile, because other Host code makes `plugins/` with the default mode. Regression test: `secretStore.test.ts` "makes the directories above the store owner-only, whatever the umask" |
| A test run left a `D:/cfg/.claude.json` folder in the repo | `src/host/orch.test.ts` fixtures used `configDir: 'D:/cfg'`, which is a relative path on Linux | The fixtures use `path.join(dir, 'cfg')` |

## Security defaults for this fork

- **Auto-update off.** `AUTO_UPDATE` (`src/core/update/autoUpdate.ts`) is a build-time define, `__ASTERA_AUTO_UPDATE__`
  in `electron.vite.config.ts`, and is true only when built with `ASTERA_AUTO_UPDATE=1`. It gates the whole
  electron-updater block in `src/main/index.ts`, including the remote `policy.json` (`loadPolicy`) fetch. The Settings
  → Info "Update" row shows `update.info.manualOnly`. The `electron-builder.yml` `publish` feed points at this fork,
  never upstream. Update by hand with `git fetch upstream && git merge upstream/main`, then rebuild.
- **Agents never bypass permissions by default.** `agentPermissionModeOf` returns `'yolo'` only for an explicit
  `'yolo'`. A missing, unknown or recovered value is `'manual'`; upstream defaulted to `'yolo'`. Consequence: Job
  workers and the coordinator stop at Claude/Codex permission prompts unless you turn on Settings → "Run agents
  without permission checks". The interactive "New session" bypass box was already off by default.
- **MCP HTTP**: off by default (`mcpHttpOf`: `enabled: o.enabled === true`). It binds `127.0.0.1` unless `lan` is set
  (`src/host/mcpHttp.ts` passes `--bind`). Bearer token.
- **Remote runtime gateway**: `REMOTE_DEFAULTS = { enabled: false, listen: '127.0.0.1', port: 47831 }`
  (`src/core/remote/settings.ts`). `astera runtime` `--listen` accepts any address, including `0.0.0.0`. Don't use
  that.
- Dependencies: electron 41.10.7, undici 7.30.1, js-yaml 4.3.2. `npm audit --omit=dev` reports 0. The remaining
  advisories are build or dev only.

## Known issues / gaps (not fixed in Wave 0)

1. ~~Reattached Claude pane is blank until a resize.~~ Fixed in W1-D, see "Closing the window" below.
2. ~~Closing the window quits the app, so rolling/scheduling stop.~~ Measured in W1-D: the app quits, but the Host
   keeps driving Jobs and rolling. Only the per-session command scheduler and desktop notices stop. See below.
3. **Dev only: the Host inherits the DevTools port.** With `electron-vite dev --remoteDebuggingPort N`, the Host
   spawned by that app inherits the listening socket. The next app launch cannot reuse port N while that Host lives.
   Use a new port, or end the Host. Packaged builds and plain `npm run dev` are not affected.
4. Electron logs `vaInitialize failed` on nouveau GPUs. Harmless (no VA-API video decode).
5. The native folder picker (`dialog.showOpenDialog`) cannot be driven over CDP. Automated UI tests need a stub or
   `xdotool` (`src/host/workspace/desktop.linux.e2e.test.ts` uses Xvfb + xdotool, gated on `ASTERA_DESKTOP_E2E=1`).

## Packaged build (AppImage / deb)

`npm run dist:linux` takes about 3 min and writes `dist-installer/astera-1.4.14-x86_64.AppImage` (131 MB) and
`astera-1.4.14-amd64.deb`.

```bash
chmod +x dist-installer/astera-*-x86_64.AppImage   # electron-builder already sets +x
./dist-installer/astera-*-x86_64.AppImage
```

- On Ubuntu 24.04 it started with no `--no-sandbox` and no extra FUSE package. If it fails with a `chrome-sandbox`
  permission error on another distro, run it once with `--no-sandbox` and record the distro here. Do not hardcode
  the flag.
- The packaged profile is `~/.config/astera`; dev uses `~/.config/astera-dev`.
- Verified: the window opens, no `updater.log` is created, and Settings → Info → Update reads "Updates are manual in
  this build: pull and rebuild from source".
- After you quit, the AppImage's Host stays alive by design and keeps the AppImage mount
  (`/tmp/.mount_astera*`) busy. End it with the close dialog's "End the kept sessions too" option.

## Closing the window (W1-D, measured 2026-10-17, XFCE on X11)

Closing the window still quits the app on Linux (no tray, `win.on('close')` in `src/main/index.ts`). That is fine for
orchestration, because the **Host** owns it, not the app.

| What | After the window closes | Why |
|---|---|---|
| Host process (`out/main/host.js`) | keeps running | started detached; `will-quit` only stops the client socket |
| Worker / session PTYs (`claude`) | keep running, parent is the Host | the Host spawns them; `runningAppOwned()` skips them at quit |
| Job dispatch loop | keeps running in the Host | the app's hello yields `HOST_YIELD_DISPATCH`, so `driverOf` answers `'host'` even while the app is open (`astera status` → `"driver":"host","appAttached":true`) |
| Job schedules (templates firing) | fire from the Host's tick (read from code, not timed by hand) | `createHostDriving` tick, "fires schedules while it drives (R5, app or no app)" |
| Account rolling | the Host takes over a gone app's roll chains after `APP_LEFT_GRACE_MS` (5 s); no limit was hit in this test | `rollingWiring.ts` / `takeover.ts`; host.log: "the app left and did not come back: the steps the app left run now" |
| Per-session command scheduler (`SchedulerCoordinator`) | **stops** | lives in main; its config is persisted (`schedulerConfig`) and resumes on reopen |
| Desktop notices | **stop** | main's `desktopNotifier`. The Host's own notifier/Slack is separate |

Measured run: a Job with two chained tasks (`c2` depends on `c1`) was started from the CLI with the app closed. The
Host dispatched `c1`, then `c2` when `c1` completed (12:08:00 → 12:08:25 → 12:08:40), with `"appAttached":false`.
On reopen the app adopted the same four worker PTYs (same pids, all children of `host.js`). No task was dispatched
again and no new worker started.

Harmless log line seen when a worker ends with no app: `unregisterRolling was not forwarded: APP_REQUIRED`.

**Why no tray / hide-to-background on Linux.** The Host already is the background process. A tray would only keep the
session scheduler and desktop notices alive, and GNOME shows no tray without an AppIndicator extension, which is why
Linux closes for real (comment on `win.on('close')`). Moving `SchedulerCoordinator` into the Host is the smallest
extension if those per-session commands must run while the app is closed. It is not done here.

**Reattach repaint (was known issue 1).** On reopen a pane replays the Host's ring (`ptyRing.ts`, 256 000 chars). For a
long Claude session that tail is only incremental redraws, so the pane looked blank. Claude repaints on SIGWINCH, but
only when the size really changes, and Linux sends no SIGWINCH for an unchanged size. `TerminalView`'s first resize
now goes one row short (`repaintNudge`), and the real size follows `REPAINT_NUDGE_MS` later. Measured on the same-size
reattach: old code got 238 bytes from the pty when the tab was shown (no repaint), the fix got 4 434 (a full redraw).

**AppImage mount.** The Host is started from the AppImage, so it keeps `/tmp/.mount_astera*` mounted after the app
quits. This is by design: the Host must outlive the app. "End the kept sessions too" in the close dialog ends the
Host and frees the mount.

**Wayland / X11.** `src/main/ozone.ts` only forces Wayland on WSLg. Elsewhere Electron picks the platform. This
machine runs X11 (XFCE), so native Wayland is not verified here.

**PATH from a `.desktop` launch.** `loginPath.ts` runs `$SHELL -ilc` and merges its PATH. Checked with
`env -i HOME=$HOME SHELL=/bin/bash PATH=/usr/bin:/bin bash -ilc 'echo $PATH'`: it recovers `~/.local/bin` (where
`claude` lives). The dev log shows `loginPath: PATH restored from /bin/bash`. No breakage found.

### Manual verification script

```bash
# 1. Start the app (fresh CDP port each launch, CONTEXT.md rule 7) and a CLI bound to its profile.
npx electron-vite dev --remoteDebuggingPort 9341 &
ast() { ASTERA_PROFILE_DIR=$HOME/.config/astera-dev ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron out/main/cli.js "$@"; }
ast status                      # expect "driver":"host","appAttached":true
# 2. Close the window (title-bar X → "Close"). Then:
ast status                      # expect "running":true,"driver":"host","appAttached":false
# 3. With the app closed, run a two-task chain in a scratch git repo:
J=$(ast jobs create --objective test --cwd /path/to/scratch-repo --concurrency 1 | jq -r .data.id)
A=$(ast accounts list | jq -r '.data.accounts[0].id')
T1=$(ast tasks add --job $J --account $A --title c1 --spec "Create c1.txt containing c1, then report done." | jq -r .data.id)
ast tasks add --job $J --account $A --title c2 --deps "[\"$T1\"]" --spec "Create c2.txt containing c2, then report done."
RUN=$(ast jobs run --id $J | jq -r .data.id)
watch -n5 "ast tasks list --run $RUN | jq -r '.data.tasks[] | .title+\" \"+.status'"   # c1 then c2 complete, app closed
ps -eo pid,ppid,args | grep '[c]laude --settings'   # note the pids; ppid is the host.js pid
# 4. Reopen the app. Expect: the same pids (no new worker), no task dispatched again, every worker tab shows its
#    screen at once (prompt box drawn), without toggling the sidebar.
```

## End-to-end check (W4, measured 2026-10-17, XFCE on X11)

Same machine as above: Ubuntu 24.04, kernel 6.14, Node 24.22.0, `claude` 2.1.301 on one Claude Max account. Run against
`main` at 5fc23484 (Waves 0–3 merged), in a scratch git repo with three files.

### Build and tests

| Step | Result |
|---|---|
| `npm ci` | 18 s. npm 11 prints `install-scripts … not yet covered by allowScripts` for electron, esbuild and node-pty, but the scripts run: `node-pty/build/Release/pty.node` and `electron/dist/electron` exist afterwards |
| `npm run typecheck` | clean, 10 s |
| `flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2` | 873 files / 15 149 tests passed, 7 files / 70 tests skipped, 0 failed, 6 m 48 s |
| `npm run build` | 10 s; needed before the `astera` CLI line in CONTEXT rule 7 |

### SPEC §11 milestone, by hand

| Milestone step | What was done | Result |
|---|---|---|
| 1. Create and persist a plan | `projects add`, `jobs create --coordinator-account`, `jobs rename --title Smoke` | the plan shows under Workspaces → w4-scratch |
| 2. Separate premium planning session | `jobs plan --id <job>` | a `claude --model opus` session, child of `host.js`, header `Task Smoke Planner · Model opus`; done in 1 m 7 s |
| 3. Structured tasks with deps | read back from `orchestration.json` | 3 Tasks, each with `prompt`, `acceptanceCriteria`, `affectedPaths`, `modelReason`, `difficulty: light`; C `deps` = [A, B] |
| 4. Tasks appear in the UI | Jobs view, Workspaces tree, Board | yes; "Approve & execute" opens the app's confirmation dialog first |
| 5. Eligible tasks launch as real sessions | approve | coordinator `claude --model haiku`, then A and B as two `--model haiku` sessions 1 s apart, each in its own worktree (`~/astera-worktrees/w4-scratch/<branch>`) |
| 6. Next eligible task scheduled automatically | wait | C started 23 s after B completed (A 18:57:32, B 18:59:16, C 18:59:39 → 19:00:25); never before |
| 7. Every session inspectable and typeable | sidebar click → type | header shows Project · Plan · Task · Model · Account · cwd · Branch · Status; typed input reached the worker |

Permissions: with "Run agents without permission checks" off, each haiku worker's first action (reading its own spec
file under `<profile>/orch/specs/`, outside its worktree) stopped at a Claude "Read outside the working directories"
prompt. The needs-input badge showed **2**, the inbox listed "Smoke Worker 1/2 is waiting", and answering one dropped
it to 1. (Fixed in W5-A, #52: `<profile>/orch/specs` is now an `--add-dir` of every session the Host or app spawns, so
reading the spec asks nothing.) CLI-made Tasks (`tasks add`) carry no difficulty, so their workers start with no `--model` flag (the CLI's
default model) and the header shows `Model —`.

### Stop / resume, restart, recovery

| Check | Result |
|---|---|
| "pause Hold2" in the bar | bar shows "Pause (closes its sessions)", then the app's "Stop the plan" dialog; coordinator and both workers ended, Run `paused` |
| "resume Hold2" | coordinator back, then exactly one new Dispatch per Task (2 workers); the old Dispatches stay closed with `closedBy: stop`. No duplicates |
| Same on a plan **without** a coordinator ("Hold") | **stuck**: Tasks stay `dispatched` on stopped Dispatches and nothing re-places them; the board says "Its worker was stopped" |
| Close the window, wait, reopen (`npx electron-vite dev`, new CDP port) | `appAttached:false` while closed; on reopen the same Host pid and the same 4 `claude` pids, no new spawn, Dispatch count unchanged (9), `orch/activity.jsonl` unchanged (43 lines) and the feed still shows the lines from before |
| Usage limit hit mid-run (5 h window at 93 %) | the feed said "k1: hit a limit on <account>, waiting for the reset" (19:09) and "k1: resumed" (22:21); the workers continued after the reset |

### Activity feed and notices

- Lines carry plan, model and account: "A: add sub to math.js: completed · Smoke · haiku · <account>", "f1: failed",
  "k1: cancelled", "k1: worker stopped by you", "Smoke: plan ready for your approval", "Smoke: plan done",
  "Smoke: PR failed".
- "Last 15 min" groups them ("5 failed · 7 blocked") and lists each blocked Task with its reason.
- Throttle, measured with `dbus-monitor "interface='org.freedesktop.Notifications',member='Notify'"`: five Tasks
  failed within 5 s (22:27:35–39) and the desktop got **three** notices (f1, f2, f3); the rest wait for the digest.
- Digest (default 30 min): at 22:54, 34 min after the app started, one "Activity summary" notice: "5 failed: f1, f2,
  f3 and 2 more · 2 cancelled: k1, k2 · 2 more notice(s) held back".
- Desktop notices on XFCE arrive through `org.freedesktop.Notifications` with app name `astera`.

### Search and command bar

- Search: `hw1` → Hold Worker 1 and Hold2 Worker 1, `sw3` → Smoke Worker 3, each with "project › plan · task".
- "show progress on Hold2" → "w4-scratch › Hold2: 0/2 done, 2 running". "show all sessions needing my input" →
  "Nobody is waiting for you". "pause worker 2" → "No plan matches "worker 2". Pick one:" with the three plans (no
  per-worker pause exists).
- `send "<text>" to Hold2 Worker 1` → "Sent to Hold2 Worker 1", and the worker answered. Before this PR it was refused
  ("sessions are answered by the Astera Host, and this caller is not one"): fixed here.
- Before this PR, text typed into the open bar could land in a terminal: a worker tab that opened or came forward took
  the keyboard, and the planner received "send "4" to Smoke Worker 2" as a prompt. Fixed here.

### Linux-specific notes from this run

- **Git identity.** On a machine with no global `user.email`, the Run's integration merge fails ("Committer identity
  unknown") and the plan's PR step reports failure. Workers worked around it with a per-command author. Fixed in
  W5-A (#51): a merge Astera runs gets `-c user.name=Astera -c user.email=astera@localhost` for whichever key git lacks
  (`mergeIdentityArgs`); nothing is written to git config. Set your own identity to have merges carry your name.
- **Driving the close dialog.** `wmctrl -c <title>` matches a title *substring* and closes the first match: in this run
  it closed a VS Code window whose title contained "Astera". Use `wmctrl -l` and `wmctrl -i -c <id>`.
- **D-Bus truncation.** `: > notify.log` on a file `dbus-monitor` is still writing leaves NUL bytes at the start;
  read it with `tr -d '\0'`.
- **Window-manager close skips the quit dialog.** The "Close and quit Astera" dialog (with "End the kept sessions too")
  belongs to the app's own title-bar X (`closeWindow` in `App.tsx`). Alt+F4 or `wmctrl -c` quits at once and keeps the
  sessions, which is the safe default but offers no way to end them.
- `MaxListenersExceededWarning: 11 session:pty-size listeners` appears in the dev log with 11 terminal tabs open: one
  listener per `TerminalView`, harmless.

### Packaged AppImage (W4)

- `npm run dist:linux`: 1 m 45 s; `astera-1.4.14-x86_64.AppImage` 131 MB and `astera-1.4.14-amd64.deb` 100 MB.
- Started with no `--no-sandbox`; the Host runs as `/tmp/.mount_astera*/astera …/app.asar/out/main/host.js`.
- Smoke on the packaged profile (`~/.config/astera`): one plan, one Task from the CLI. The worker started 7 s after
  `jobs run` and completed 23 s later. The feed showed "p1: running / worker started / completed / worker exited" and
  "Packaged: plan done". The desktop got a "Plan done" notice.
- The in-app X opened "Close and quit Astera … 1 running session(s) keep running", with "End the 1 kept session(s) too".
  Ticking that ended the Host, and the `/tmp/.mount_astera*` mount was released.

## Autopilot dogfood (W6-V, measured 2026-10-18, XFCE on X11)

Same machine, `claude` 2.1.301, dev app from `main` at 9467f5c3 (Waves 0–6 merged; Wave 7 not yet). Scratch repo
`/tmp/astera-dogfood`: a small TypeScript project tested with `node --test test/*.test.ts` (Node 24 strips the types,
no build). One Claude account; settings left at their defaults (agents keep permission checks, `usagePauseAt` 90,
`maxSubagentsPerSession` 10). The app was driven over CDP (`--remoteDebuggingPort 9351`), desktop notices read with
`dbus-monitor`, the chime with a hook on `AudioContext.createOscillator` in the renderer. Issues: #67–#84.

### Runs

| Plan | Started from | Planner | Tasks / waves | Result |
|---|---|---|---|---|
| 6-problem fixlist + 1 extra instruction | New plan dialog | 1 m 32 s, opus, $1.62 | 5 / 1 (problems 1+2 merged: same file) | done 12 min after approval (7 of them waiting on the owner's answer); final check "nothing to add"; PR step "push was rejected" (no remote, #80) |
| 3-page PDF (`--attach`), "one Task per item" | CLI | 51 s, $0.67, read the PDF itself | 3 / 2 (the two `src/strings.ts` items chained by a dep) | replan between waves "no change", isBlank after reverse |
| `--mode audit --scope src` | CLI | 73 s; wrote `inputs/audit.md` (8 findings) | 4 / 1 | 4 haiku/sonnet workers at once, done in 24 s, final check "F1–F8 all fixed, 23/23 tests" |
| GitHub issues #1, #2 (private scratch repo) `--assign-me` | `jobs-create-from-issue` | 45 s | 2 / 1 | both issues assigned to the owner; PR #3 opened in the scratch repo; no final check (#74) |
| "Add clamp()" (already in `src/math.ts`) | CLI | 22 s; `existing.md` marked it `built` | 0 | `plan.nothing-to-do`, no tab opened |
| `push` delivery, local bare `origin` | CLI | 35 s | 1 / 1 | `Deliver plan: Push check` merged on `main` and pushed; folder clean; worktrees removed |
| same, with an uncommitted edit in the folder | CLI | 29 s | 1 / 1 | escalated "Delivery stopped: your folder … has 1 uncommitted change(s)"; HEAD, origin and the edit untouched |

### Wave 6 checks

| Check | Result |
|---|---|
| Planner fills `affectedPaths`, basis and waves | yes on every Task. Planners merge or chain same-file work themselves, so W6-C's "waiting for … same files" reason never showed in the app (two Tasks on one file never ran at once) |
| Worker question answered by the coordinator | `question.auto-answered` 26 s after the price worker started ("-$1.50 or $-1.50?"); card "1 questions answered" |
| Escalation (EUR or USD) | `task.escalated`, desktop notice "Needs your decision", needs-input badge 1. **No chime** (#71). No way to answer it but typing into the coordinator, which then queued the answer for 7 min behind its own `sleep 5` loop (#72, #73) |
| Replan banner between waves, final check | "Replanning wave 2…" on the board for 20 s, `plan.replanned` "no change"; final check on 4 of 5 planned plans (missing on the issue plan, twice on the first, #74) |
| "Now" line per tab | "Running cat src/price.ts …", "Running git add -A && git commit …", "Asked the coordinator", with "· 0:01 ago" |
| Project switching (W6-F) | the switcher lists projects with tab counts; astera-dogfood-gh showed only its 3 tabs, astera-dogfood its 21 |
| 12 parallel subagents in one worker tab | 10 ran; #11 and #12 refused: "Astera: 10 subagents already running in this tab (limit 10). Wait for one to finish." `<profile>/hook-events/<session>.subagents` went 10 → 0 |
| `usagePauseAt` 1 (5-hour reading 1 %) | `usage.paused` at once; `worker-start` refused "until 14:50 UTC"; board "Paused: <account> at 1% of its 5-hour limit, resumes ~17:50". Raised to 90: `usage.resumed` after 15 s, but no worker started until the coordinator was told (#73) |
| Reviewer per Task | none ran: validating → completed in about 1 s (#70) |
| `existing.md` | written for plan-mode and issue plans; not for fixlist or audit plans (brief forbids files, #69) |

### Costs and load

- Five-hour usage on the account went from 1 % to 2 % across all seven plans. Haiku workers cost $0.01–0.12 each
  (the 12-subagent test was $0.12); planners $0.43–1.62 on opus.
- Up to 7 `claude` sessions ran at once (audit + issue plans) with no load problem; the app, Host and 21 tabs stayed
  responsive. No full test suite was run during the dogfood (rule 7).

### Linux-specific notes from this run

- **Claude's auto mode.** Planners, coordinators and workers started with permission checks on still ran in Claude
  Code 2.1's "auto mode" (status line `⏵⏵ auto mode on`), which approved their reads, edits and commits: not one
  permission prompt in seven plans. The needs-input list only ever held the escalation.
- **One account, re-logged.** Running `claude /login` as another account in `~/.claude` keeps Astera's row label and
  its old usage until a fresh statusLine reading arrives (#77). The 7-day reading went from 96 % to 0 % only after the
  first session on the new login.
- **`dbus-monitor` and silent notices.** Electron on Linux sends no `suppress-sound` hint here even when the app meant
  the notice to be silent, so the hint cannot prove whether `chime` was set; hook the renderer instead.
- A session started with `astera sessions create` is adopted as a tab but counts as open only after a click (#78).
- `pkill -f "<pattern>"` from a shell whose own command line contains the pattern kills that shell (exit 144). Use
  `pgrep` first.

## Autopilot re-run (7V, measured 2026-10-18, XFCE on X11)

Same machine, `claude` 2.1.301, dev app from `main` at 238558af (Waves 0–7 merged). The project was made with W7-B's
"New project" (`/tmp/astera-dogfood`), then given a small TypeScript library tested with `node --test`. One Claude
account; agents kept permission checks (Claude's auto mode approved everything again, no permission prompt in seven
plans). The app was driven over CDP (`--remoteDebuggingPort 9361`), notices read with `dbus-monitor`, the chime with a
hook on `AudioContext.createOscillator` (one chime = two oscillator calls). Issues: #92–#106.

### Runs

| Plan | Started from | Planner | Tasks | Result |
|---|---|---|---|---|
| 6-problem fixlist + 1 extra instruction, workers 10 | New plan dialog | 2 m 19 s, then 3 feedback rounds (35 s, 26 s, CLI) | 7 / 2 waves (P7 added by feedback) | approved 16:56, done 17:08 (12.6 min; ~6 min lost to a false Gate and a coordinator that was not woken, #95 #96); one final check; "no remote, work on branch …" |
| "Add clamp()" (already built) | CLI | 39 s | 0 | `plan.nothing-to-do`, `existing.md` marks it `built` |
| 3-page PDF (`--attach`) | CLI | 55 s, read the PDF itself | 3 (two same-file items chained) | rejected from the Run window (step 5) |
| `--mode audit --scope src`, project auto-approve on | CLI | 2 m 06 s, `audit.md` + `existing.md` | 3 | auto-started; held by `usagePauseAt` 10, resumed on its own; F3 failed after 3 repairs, then the Run never ended (#99, #100, #101) |
| GitHub #4, #5 `--assign-me` (private scratch repo, issues made with the owner's OK) | `jobs-create-from-issue` | ~55 s | 2 | done in 1.5 min, final check ran, PR #6 opened |
| `push`, bare local `origin` | CLI | 45 s | 1 | stopped "origin/HEAD is not set" (#102); after `--delivery-branch main` + `run-deliver --force`: merged and pushed |
| same, uncommitted edit in the folder | CLI | 53 s | 1 | escalated "your folder … has 1 uncommitted change(s)", chime; HEAD, origin and the edit untouched |

### Checks (W6 and W7)

| Check | Result |
|---|---|
| New project (W7-B) | works, but only once a tab is open ("Open a tab first", #104); writes CLAUDE.md with GitHub rules, commits as `Astera` |
| Plan name, worker count (#67 #68) | fixed: named by its first problem / "#4 … +1" / "Audit src" / the PDF's file name; "Workers at once" 10 |
| `affectedPaths`, waves, basis, `existing.md` for a fixlist (#69) | yes on every planned Task; `existing.md` for fixlist and audit plans now |
| Same-file guard | **failed** (#92): P1+P2 and P4+P7 ran at once. The coordinator's `worker-start` has no same-file check |
| Feedback rounds (W7-A) | the plan changed each time, but the app's box started a fresh planner every round (two alive at once); only the CLI resumed (`--resume`, #93). A feedback planner's Task lacked a basis; approval said so only in a toast (#94) |
| Reject, auto-approve (W7-A) | reject archives with the reason and ends the planner; auto-approve started the audit plan with no one asked |
| Reviewer per Task (#70) | fixed: an opus review dispatch after every Task |
| Worker question → coordinator | `question.auto-answered` (git identity, twice) |
| Escalation (EUR or USD) (#71 #72) | one chime + "Needs your decision"; answered from the card's box, the worker had it at once. The coordinator also escalated a format detail it had been told to decide |
| Coordinator Gates | no answer box on the card (#97); CLI only. `--answer -` kept the newline and missed the option (#98) |
| Replan between waves | ran (51 s), but its hold made the coordinator open a false owner Gate with a chime, and the replan then skipped P6 (#95) |
| Final check (#74) | exactly once on the fixlist, issue and push plans; never on a plan with a failed Task (#99) |
| "Now" lines, project switching | "Running git branch … · 0:00 ago", "Asked the coordinator"; the switcher narrows to the project's tabs |
| 12 subagents in a worker tab | 10 ran; #11 and #12: "Astera: 10 subagents already running in this tab (limit 10). Wait for one to finish." |
| `usagePauseAt` 10 (5-hour at 18 %) | `usage.paused` after ~1 min; `worker-start` refused with the reset time; back to 90: `usage.resumed` in 20 s and workers started 8 s later with no nudge (#73 fixed) |
| Ended tabs (W7-F) | all 15 sessions of the done plan ended (coordinator 10 min after) and their tabs closed |
| Push (W6-H) | lands on `main` and pushes once the delivery branch is set; dirty folder stops and touches nothing |

### Costs and load

- Five-hour usage went from 17 % to 19 % across the seven plans (one 5-hour reset in between); weekly 5 %.
- Up to 16 `claude` sessions were alive at once (6 workers, 6 reviewers, coordinator, planner, two plain tabs); the
  app and Host stayed responsive. No test suite ran during the dogfood (rule 7).

### Linux-specific notes from this run

- **A Gate answer does not wake a coordinator.** It waits in a background `astera check --wait --timeout-ms 600000`
  and ends its turn; Claude Code wakes it only when that shell ends, so an answer can wait up to 10 min (#96).
- **`pkill -f` again.** `pkill -f "dbus-monitor …"` from a shell whose own command line held the pattern killed that
  shell (exit 144). Kill by pid from `pgrep -af`.
- `astera host stop` ends the dev Host cleanly once its sessions are gone.
- A bare repo made with `git init --bare` and filled by `git push -u origin main` has no `origin/HEAD` in the clone;
  `git remote set-head origin -a` sets it, or set the project's delivery branch.
