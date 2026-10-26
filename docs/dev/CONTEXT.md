# Orchestrator work — shared context for every Claude tab

Read this whole file before doing anything. Every prompt in `docs/dev/prompts/` assumes it.

## What this repo is

Personal private fork of Astera (`github.com/JanoTheDev/astera-orchestrator`, upstream `parsingk/Astera`,
Apache-2.0). Electron + electron-vite + React + TypeScript. Target platform for this fork: **Linux**
(the owner runs Linux; upstream says Linux is untested on real machines).

Goal: turn Astera's existing **Jobs** system into the orchestrator described in `docs/dev/SPEC.md`.
**Do not build a second orchestrator, terminal manager, account manager, or task tracker.** Extend what exists.

## Vocabulary mapping (spec → existing code)

| Spec term | Existing concept | Where |
|---|---|---|
| Project | orchestration `Project` | `src/core/orchestration/types.ts` (`interface Project`), `projects.ts` |
| Plan | `Job` (the plan) + `JobRun` (one execution of it) | `types.ts` (`interface Job`, `interface JobRun`) |
| Task | `Task` (has `deps[]`, `spec`, `status`, `accountIds`) | `types.ts` (`interface Task`), state machine `ALLOWED`, `recomputeReady` |
| Worker CLI session | `Dispatch` (one attempt = one real PTY session) | `types.ts` (`interface Dispatch`), `exec/workerStart.ts`, `exec/coordinator.ts` |
| Coordinator / planner | coordinator LLM session (plans, never edits files) | `exec/workerStart.ts` (`startCoordinatorSession`), `handover.ts`, `resources/skills/orchestration-guide.md` |
| Scheduler | pure `slotsToFill` + 15 s `createDispatchLoop` tick | `schedule.ts`, `exec/dispatchLoop.ts` |
| Completion / retries / review | `ConvergencePolicy`, validator, cross-provider reviewer, repair dispatches, Gates | `convergence.ts`, `exec/validator.ts`, `reviewer.ts`, `exec/repair.ts`, `state.ts` |
| Persistence + recovery | `<profile>/orchestration.json` (atomic write, `.bak`), host recovery | `store.ts`, `src/host/recovery.ts`, `exec/resumeSweep.ts`, `lostGate.ts` |
| Worktrees | `createWorktree`, `WorktreeRegistry` (`~/astera-worktrees`) | `src/core/worktrees/*`, `exec/integrateGit.ts`, `integrate.ts` |
| Terminals | node-pty in the **Host** process (outlives the app), `SessionManager`, `SessionDriver` (programmatic input) | `src/host/*`, `src/core/sessions/*`, `src/main/host/*` |
| Session state | hooks → `hook-events/<sid>.jsonl` → `sessionStateOf`; attention idle/working/waiting | `src/core/hooks/*`, `src/core/sessions/attention.ts` |
| Accounts / rolling / usage | `Account`, `RollCycle`, `RateLimitFetcher` | `src/core/accounts`, `src/core/rolling`, `src/core/usage` |
| Commands | ~84 `astera` orchestration commands (also exposed over MCP) | `src/core/orchestration/command.ts`, `src/cli/mcp` |
| GitHub | `gh` CLI wrapper, PRs, checks, issues-as-job-source | `src/core/github/*`, `src/main/githubPrs.ts` |
| Notifications | Slack notifier/inbox, desktop notifier | `src/core/slack/*`, `src/main/desktopNotifier.ts` |
| UI | `JobsView.tsx`, `RunDetail.tsx`, `NewRunModal.tsx`, `NewTaskModal.tsx`, `GateAnswer.tsx`; state in `App.tsx` (5.6k lines, `useState`, no store) | `src/renderer/src/*` |

Design docs worth reading for your area: `docs/jobs.md` (Korean), `docs/how-it-works.md`,
`knowledge/decisions/ADR-*.md` (ADR-004 persistence, ADR-005 cite code by symbol not line).
Many code comments are Korean — read them, they carry the invariants.

## Rules for every tab

1. **Isolation.** Work only in your own git worktree on your own branch (the prompt gives the name):
   ```bash
   cd /home/jonx/Desktop/Astera && git fetch origin
   git worktree add ../astera-wt/<slug> -b <branch> origin/main
   cd ../astera-wt/<slug> && npm ci
   ```
   Never edit `/home/jonx/Desktop/Astera` itself. Never touch another tab's worktree.
2. **Stay in your lane.** Each prompt lists files you OWN and files you may only touch additively.
   Shared hot files (`types.ts`, `command.ts`, `App.tsx`, settings types): append new fields/commands in
   their own block with a comment naming your task, don't reorder or reformat existing code — that keeps
   merges trivial.
3. **Extend, don't fork.** Before writing anything, find the existing code that does the nearest thing
   and extend it. If you believe something new is needed, say why in the PR description.
4. **Tests.** Tests live next to code (`*.test.ts`, vitest, `environment: node`). Add tests for every new
   pure function and state transition. Run before pushing:
   ```bash
   npm run typecheck && npx vitest run --maxWorkers=2 <your test files>
   astera heavy -- nice -n 10 npx vitest run --maxWorkers=2                   # the full suite, in an Astera worker
   flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2   # the full suite, in a hand-opened tab
   ```
   Both lines take the same lock (`/tmp/astera-fullsuite.lock`), so workers and hand tabs share one slot (W8-C).
   **Never run bare `npm test`.** Four tabs running it at default workers, alongside Electron, crashed the
   owner's laptop in Wave 0. The `flock` line queues full runs across tabs, so only one runs at a time. While
   `npm run dev`, `npm run dist:linux` or another tab's full suite is running, run only your own test files.
   Stop any `npm run dev` / Electron you started before you finish.
   If a pre-existing test fails on Linux and it is not yours, note it in the PR — do not "fix" it unless
   your prompt says so. Never claim done without pasting the test summary into the PR.
5. **Linux.** Everything must work on Linux. No `process.platform === 'win32'`-only paths for new
   features; use `path`/`isSamePath` helpers the repo already has.
6. **Safety.** Voice/NL input is never authorization for destructive actions (kill, delete, merge, force
   push, archive-with-kill) — require explicit UI confirmation. Never auto-switch accounts beyond what the
   existing rolling feature already does and the user enabled. Never send credentials anywhere.
7. **Linux and runtime facts (Waves 0–1)** (`docs/dev/LINUX.md` is the Linux source of truth: read it, and update it
   when you learn something about Linux):
   - Agents never bypass permissions by default: `agentPermissionModeOf` returns `'yolo'` only when set
     explicitly. Job workers and the coordinator therefore stop at Claude permission prompts unless the
     owner enables Settings → "Run agents without permission checks". Never flip this default back. Design
     around it: surface "waiting for permission" and let the owner answer.
   - Auto-update is off (`AUTO_UPDATE`, `src/core/update/autoUpdate.ts`). Don't add network calls to upstream.
   - Ubuntu's umask is 002, so new dirs are 775. Anything that checks modes must create its dirs with an
     explicit `mode`.
   - Windows-style test paths such as `'D:/cfg'` are *relative* on Linux and get written into the cwd. Use
     paths under the test's temp dir.
   - Driving the app for manual checks: `npx electron-vite dev --remoteDebuggingPort <fresh port>` + CDP.
   - **Screenshots**: `scripts/shoot.mjs` shoots pages of a running dev app over CDP. Pages (`--pages`, default all): sessions, plans, start (New plan), mainplan, history, explorer, scm, run, devices, switcher, accounts, settings, and for the `--showcase` seed planboard (an open plan tab), planstree, needsyou and activity (bottom panel tabs), taskdetail, settings-agents (Settings > Agents) and editor (Explorer with a file open); `docs/dev/shots/SEED.md` ("Showcase seed") maps them to `assets/docs/`. Sizes (`--sizes`) default to 1440×900 and 1024×640; the plan shots use `--sizes 1920x1080,1000x800`. Themes (`--themes`) default to Night and Day; the theme is switched through Settings and restored at the end. Files are `<page>-<WxH>-<theme>.png`. Before each shot it waits up to 30 s until the page has loaded (no "Loading"/"Scanning" text; History waits for a session row) and skips a page that never loads or cannot be reached. For screens that need data, seed a temporary profile with `scripts/shots-seed.mjs` and start the app on it as `docs/dev/shots/SEED.md` says (one Electron at a time, wrapped in `astera heavy --`, a fresh debugging port, stop that profile's Host afterwards), then `npm run shots -- --port <port> --out <dir>`. The plan screens' before/after shots live in `docs/shots/before/` and `docs/shots/after/`, each with a `NOTES.md`.
     Use a new port every launch, because the Host inherits the old socket. Native dialogs can't be driven
     over CDP.
   - **The Host drives Jobs**, even while the app is open (`driverOf` answers `'host'`, `src/host/driving.ts`), and
     keeps dispatching when the window is closed. A gate on starting work must hold on the Host's command path, not
     only the app's.
   - The `astera` CLI against the dev profile, from a worktree after a build:
     `ASTERA_PROFILE_DIR=~/.config/astera-dev ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron out/main/cli.js <cmd>`
   - **Manual checks in the real app**: all tabs share one dev profile (`~/.config/astera-dev`) and its Host, so only
     one tab runs the app at a time. Test Jobs start real `claude` sessions on the owner's account: keep them to one
     or two tiny tasks in a scratch repo. Clean up afterwards: `jobs archive --id <job> --kill-sessions`, then remove
     the test worktrees and scratch repo.
9. **Reuse Wave 1.** Archived/paused/not-started: `isJobActive` (`lifecycle.ts`) and `jobActive` (`schedule.ts`).
   Models: `resolveRoleModel` / `resolveWorkerModel` (`roleModels.ts`), `Dispatch.model`. App-wide cap:
   `maxConcurrentWorkers` (`src/core/settings/maxConcurrentWorkers.ts`), `Job.priority`. Plan name: `Job.title` via
   `jobNameOf`. Don't add another copy of these rules.
10. **Reuse Wave 2.** Planner: `jobs plan --id <job>` starts it (`exec/plannerStart.ts`); its sessions are
   `Job.plannerSessionIds`. `plannerRefusal` (`planner.ts`) runs first in `handleCommand` and is an **allowlist**:
   a new command is refused to planners until added to `PLANNER_COMMANDS`. Plan Tasks carry `prompt`,
   `acceptanceCriteria`, `affectedPaths`, `modelReason`; `validatePlan` checks them. **Approving a plan is
   `run-start --run <jobId>` from the app or the person's shell; it is refused from any agent session**, and answers
   `{ error, problems[] }` while the plan does not hold. A plan awaiting approval is
   `job.pendingStart && job.plannerSessionIds !== undefined`. Why a Task is not running: `taskBoardsOf`
   (`blocked.ts`, W2-C), carried on `JobTask.board`. Project → Plan → sessions tree: `workspaceTree.ts`,
   `useWorkspaceData`, `useAttention` (`components/workspace/`, W2-B). GitHub: `Task.links`, `JobRun.pr`,
   `task-link-issue`, `run-open-pr` (`src/core/github/taskLinks.ts`, W2-D). Use these; don't re-derive them.
11. **Finish.** Commit in small logical commits, push the branch, open a PR **into `main` of
   `JanoTheDev/astera-orchestrator`** (`gh pr create --base main`). PR body: what changed, which existing
   code you extended, test output, known gaps. Do not merge it yourself.
