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
