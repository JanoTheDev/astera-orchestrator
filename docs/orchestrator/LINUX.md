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

1. **Reattached Claude pane is blank until a resize.** After you reopen the app, the reattached session tab is empty,
   but input still works. Toggling the sidebar (any resize) makes the TUI repaint the full screen. A full repaint is
   likely needed on reattach (a forced resize/SIGWINCH after attach). For W1-D / W3-D.
2. **Closing the window quits the app.** Rolling/scheduling then stop, even though the Host keeps the PTYs. This is
   W1-D's job.
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
