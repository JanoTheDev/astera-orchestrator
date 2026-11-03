# Console windows audit: every start, and the scan that keeps it so (2026-11-01)

Why: node.exe console windows kept popping up on the owner's desktop. One cause was fixed in c4513daa0
(Claude's detached `npm view` update check, now off through `DISABLE_AUTOUPDATER=1` in `cliEnvFor`).
This records the audit for the others, so a reviewer can check the rule instead of re-deriving it.

## The rule

On Windows a process started `detached` gets `DETACHED_PROCESS`: it holds **no console**, so every console
program it starts (a git hook running lefthook, node or bun; `npm`, `npx`, `go`) is handed a NEW, visible
console. A start with `windowsHide: true` and no `detached` gets `CREATE_NO_WINDOW`: it holds a hidden
console, and its console children inherit that one. So a start that runs other people's programs is
`windowsHide: true` and not detached on win32.

## Starts that run third-party console programs, and how each is hidden

| Start | Runs | Hidden by |
|---|---|---|
| `src/core/understanding/agent.ts` (`claude -p` understanding runs) | claude, and what it starts | `windowsHide: true`, not detached |
| `src/core/worktrees/setup.ts` (setup installs, `shell: true`) | npm, pnpm, go, ... | `windowsHide: true`; `detached: process.platform !== 'win32'` |
| `src/core/worktrees/git.ts` (all git, hooks included), `integrateGit.ts` (through `git()`) | git, then its hooks (lefthook, node, bun) | `windowsHide: true`, not detached |
| `src/core/github/gh.ts` | gh | `windowsHide: true`, not detached |
| `src/host/checks.ts` (completion checks) | the check commands, in a pty | ConPTY: the program is attached to a pseudo console, which has no window; its kill runner is `execFile` with `windowsHide: true` |
| `src/core/orchestration/exec/validation.ts` | starts nothing itself (no `child_process` import); runs go through the injected run manager | n/a |
| `src/core/attribution/gitAi.ts` (`git-ai --version`) | git-ai | **was missing**: `exec` was a parameter (`exec: typeof execFile = execFile`), which the scan did not see. Now `windowsHide: true` |
| `src/host/workspace/scriptWorker.ts` (the workspace script child) | node (the Host's runtime) running a vm script | `windowsHide: true`; no longer detached on win32 (below) |
| node-pty (`src/host/index.ts`, `src/core/sessions/nodePtyFactory.ts`) | the user's shell / agent | ConPTY has no window. The helper node-pty forks on every kill is hidden by `hideForkedConsoleWindows` (Host) and the `fork` path of `hideChildConsoleWindows` (app, CLI) |

Backstop at run time (`src/core/childWindows.ts`): the Host patches `ChildProcess.prototype.spawn` and the
sync starters with no exception for detached children, so even a start that forgot `windowsHide` is hidden
there. The app and CLI guard (`hideChildConsoleWindows`) leaves a `detached` start as its call site wrote
it, on purpose: electron-updater starts the NSIS installer (a GUI) detached, and `windowsHide` would hide
its window. Every detached start in those two processes is listed below, so that exception hides nothing.

## Every `detached` start in src/main, src/core, src/host, src/cli

| Start | Decision |
|---|---|
| `src/core/host/spawn.ts` (the Host) | **Kept.** It must outlive the app. It is a console program with no console, and that is fine: every child it starts passes through the Host's guard (no `exceptDetached`) and is created with `CREATE_NO_WINDOW` |
| `src/host/workspace/scriptWorker.ts` | **Changed** to `detached: process.platform !== 'win32'`. The process group is only needed off win32 (`endChild` uses `taskkill /T` there). The vm script cannot `require`, so no console program was ever started from it, but a hidden console costs nothing and covers what the sandbox might leak |
| `src/core/worktrees/setup.ts`, `src/host/plugins/runtime.ts` | Already `detached: process.platform !== 'win32'` |
| `src/main/loginPath.ts` (`runDetached`) | **Kept.** Reached only when `process.platform !== 'win32'`; win32 uses the `execFile` branch with `windowsHide` |
| `src/main/sourceUpdate.ts` (`sh` relaunching the AppImage) | **Kept.** Linux-only (`selfInstall`) |
| `src/host/workspace/posixProc.ts` | **Kept.** The workspace tools on Linux and macOS only (the process group of a launch) |
| `src/cli/run.ts` | `detached: false` |

## How the build keeps it so

`src/core/childWindows.scan.test.ts` (text based, no AST):

- finds starters reached through a parameter or property (`exec: typeof execFile = execFile`,
  `spawn?: typeof spawn`, `(opts.spawn ?? spawn)(...)`), not only direct imports, and requires `windowsHide`
  in the call's own argument list;
- lists `node-pty` `spawn` calls on the allowlist, with why a ConPTY opens no window;
- flags every `detached` start whose value is not `false` and does not name `win32`, unless the line sits
  on `DETACHED_ALLOWED` with its reason. Both allowlists fail on a stale entry.

Not covered: `shell.openPath` / `openExternal` (they open folders, media and URLs; `resolveLink.ts`
refuses to hand `openPath` a file), and libraries that start processes inside their own code
(electron-updater, node-pty's helper above).

## 2026-11-03: the windows that were left, and why the diagnostic missed them

The 15 s window diagnostic logged "0 visible windows" while node.exe windows kept flashing. Two reasons: the windows
live well under a second, and on Windows 11 a console program given a NEW visible console is handed off to Windows
Terminal (OpenConsole.exe -Embedding, started through COM), so the window belongs to WindowsTerminal.exe, never to a
Host descendant. `src/host/windowDiagnostic.ts` is now a watcher (EnumWindows every 100 ms in one hidden PowerShell,
the owner's parent chain read when the window appears). The handed-off console's `PseudoConsoleWindow` is owned by the
program that got the console, so its chain names who started it.

Measured with it on the owner's machine: Astera's own starts (hooks, statusLine, CLI, MCP server, git, the Host) open
no window: Claude Code starts hook and tool shells with a hidden console of their own, and their children inherit it.
The windows titled `C:\Program Files\nodejs\node.exe` came from a project's own Claude hook (Gameful-Monorepo
`tools/hooks/typecheck-edited.ts`, PostToolUse on Edit|Write): `spawn(tsc, …, { detached: true })` with no
`windowsHide`. Detached is DETACHED_PROCESS on win32, so the tsc.exe shim holds no console and the node it starts gets a
new visible one, after every edit in every session. The fix belongs in that repo (`detached` off win32,
`windowsHide: true`), not here.

The scan also reads node scripts held in strings that `require('child_process')` (the statusLine capture script Claude
Code runs), so a start inside an installed script needs `windowsHide` too.
