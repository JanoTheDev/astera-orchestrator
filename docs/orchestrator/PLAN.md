# Orchestrator implementation plan

Inputs: `SPEC.md` (requirements), `CONTEXT.md` (architecture map + rules), `SECURITY-AUDIT.md`.

## Key finding

Astera's **Jobs** system already does most of the spec:
- Project, Job (plan), JobRun
- Tasks with a dependency graph
- One real PTY worker session per Dispatch
- An LLM coordinator that plans and never edits
- Per-Job concurrency
- validate → cross-provider review → repair loop, with a retry limit and Gates for manual approval
- Atomic JSON persistence and Host-side recovery
- Account rolling
- Worktrees per task plus integration merge
- Slack and desktop notifications
- `gh`-based PRs and issue sources

The work is therefore **gap-filling on top of Jobs**, not a new system.

## Gap analysis

| Spec item | Exists | Gap → wave |
|---|---|---|
| Plan persisted, Project→Plan→Task→Session | Yes (Project/Job/Task/Dispatch, `orchestration.json`) | No plan **title/rename** or **archive** → W1-C |
| Separate premium planner | Coordinator plans *and* drives execution | Plan-only **planner mode** (may create Tasks, may not start workers or edit). Structured task fields (prompt, acceptance criteria, affected files). Approve → execute. → W2-A |
| Per-role models | None. Terminal sessions get no `--model`; the pane types `/model` | Role model config (coordinator/planner/worker/reviewer/NL-assistant), with app defaults plus per-Job override, passed at spawn → W1-A |
| Dependency scheduling, completion signals, retries, gates | Yes (`slotsToFill`, `recomputeReady`, `worker_done`, convergence, Gates) | Mostly tests. Add a "why is this task not running" explanation → W2-C |
| Global concurrency across plans + priority | Per-Job `concurrency` only | App-wide cap + `Job.priority` + fair allocation in `slotsToFill`/dispatch loop → W1-B |
| Pause one plan without others | `Job.paused` / `JobRun.paused` exist | Verify isolation with tests → W1-B |
| Real interactive sessions, routing input | Yes (Host PTYs, `SessionDriver`, `sessions-send`) | Show project/plan/task/model/branch on each session; routing tests → W2-B, W3-D |
| Sessions survive switching / restart | The Host outlives the app; the pane tree is in memory only | Plan-scoped workspace view built from orchestration data, so it rebuilds after restart → W2-B. **Linux: closing the window quits the app and stops rolling/scheduling unless the Host owns sessions** → W1-D |
| Sidebar Project→Plan tree, cross-project search, "needs my input" | History sidebar only | W2-B (tree), W3-C (search/inbox) |
| GitHub task↔issue/branch/PR links, no duplicate issues | PRs, checks, issue *source* | Task link fields, dedup lookup, respect repo CLAUDE.md → W2-D |
| Activity feed, summaries, throttled notifications | Slack/desktop per event | Event log + digest + UI feed → W3-A |
| Voice / NL commands | None (dormant Dictate button only) | Intent layer: text command bar first, `SpeechProvider` interface + push-to-talk, ambiguity resolution, destructive-confirm → W3-B |
| Linux works | CI builds Linux; never verified on a real machine | Wave 0 + W1-D + W4 |
| Security | Clean; auto-update points to upstream | Disable auto-update and remote policy; bump electron/undici → Wave 0 |

## Waves

Run the prompts of one wave in parallel tabs. After each wave, run `MERGE.md` in **one** tab before
starting the next wave. Each prompt owns its own files, which keeps conflicts to small additive hunks in
`types.ts`, `command.ts` and the settings types.

| Wave | Tabs | Prompts | Depends on |
|---|---|---|---|
| 0 (done) | 1 | `W0-linux-baseline-and-security.md` | — |
| 1 (done) | 4 | `W1-A-role-models`, `W1-B-global-scheduling`, `W1-C-plan-lifecycle`, `W1-D-linux-background` | W0 merged |
| 2 (done) | 4 | `W2-A-planner-stage`, `W2-B-workspace-sidebar`, `W2-C-plan-board`, `W2-D-github-links` | W1 merged |
| 3 (done) | 4 | `W3-A-activity-feed`, `W3-B-command-and-voice`, `W3-C-search-and-inbox`, `W3-D-routing-recovery-tests` | W2 merged |
| 4 (done) | 1 | `W4-final-linux-verification.md` | W3 merged |
| 5 (done) | 4 | `W5-A-worker-spawn-and-worktrees`, `W5-B-run-lifecycle-and-cli`, `W5-C-holds-and-command-bar`, `W5-D-feed-inbox-and-runtimes` (W4's issues #38–#53) | W4 merged |
| 6 (done) | 8 | `W6-A-intake-and-github`, `W6-B-autopilot-answers-and-sound`, `W6-C-scheduler-guards`, `W6-D-wave-replanning`, `W6-E-progress-view`, `W6-F-project-workspaces`, `W6-G-usage-guards`, `W6-H-delivery-modes` (Autopilot, see below) | W5 merged, **including PR #57** |
| 7 (done) | 6 | `W7-A-plan-feedback`, `W7-B-projects`, `W7-C-owner-answers-and-coordinator`, `W7-D-intake-names-and-concurrency`, `W7-E-planner-review-and-final-check`, `W7-F-tabs-accounts-and-sidebar` (W7-C..F: W6-V's issues #67–#84) | W6 merged |
| 7V (done) | 1 | `W6-V-autopilot-dogfood.md`: the W6 half ran 2026-10-18 (LINUX.md "Autopilot dogfood (W6-V)"); the full re-run after W7 ran the same day (LINUX.md "Autopilot re-run (7V)", issues #92–#106) | W7 merged |
| 8.0 (done) | 2 | `W8-C-run-waves-in-astera`, `W8-E-coordinator-guards` (7V's #92 #95 #96 #99: the W8 Astera plan needs them); tabs, the last wave run by hand | 7V done |
| 8 | 5 | `W8-A-commit-attribution`, `W8-B-line-attribution` (Who wrote this, see below), `W8-D-plans-side-by-side` (no overlapping work across plans), `W8-F-owner-talk-and-answers`, `W8-G-projects-and-delivery` (7V's #93 #94 #97 #98 #100, #101–#105), **run as one Astera plan** | W8-C and W8-E merged |
| 9.0 (done) | 1 | `W9-0-design-spec` (owner approves the mockup before any code) | W8 merged |
| 9.1 | 1 | `W9-A-foundation` (alone: tokens, primitives, shell split) | 9.0 approved |
| 9.2 | 8 | `W9-B-shell-and-nav`, `W9-C-plan-tab`, `W9-D-inbox-and-command`, `W9-E-settings-and-dialogs`, `W9-H-agents-wall`, `W9-I-tab-summaries`, `W9-J-worktree-viewer`, `W9-K-window-per-project` | 9.1 merged |
| 9.3 | 1 | `W9-F-polish-and-verify` | 9.2 merged |
| 9.4 | 1 | `W9-G-readme-and-docs` | 9.3 merged |
| 10 | 1 | `W10-A-run-by-name` (Run as written from typed names, no attaching; "next waves"), one Astera plan | W9 merged |

`(done)` in the Wave cell means that wave is finished: "Run as written" (`astera jobs create --mode prompts`) skips the prompts of a done row and lists them in the approval as "already done".

### File ownership per wave (prevents tabs interfering)

| Prompt | Owns (free to edit) | Additive-only touches |
|---|---|---|
| W1-A | new `src/core/orchestration/roleModels.ts`, spawn-args in `exec/workerStart.ts`, `exec/coordinator.ts`, new `OrchestratorModelsSettings.tsx` | `types.ts` (`Job.models`), app-settings type, settings dialog mount |
| W1-B | `schedule.ts`, `exec/dispatchLoop.ts` | `types.ts` (`Job.priority`), app-settings type |
| W1-C | new `src/core/orchestration/lifecycle.ts`, `store.ts` | `types.ts` (`Job.title`, `Job.archivedAt`), `command.ts` (new commands), `JobsView.tsx` (archive filter, rename) |
| W1-D | `src/main/index.ts` window/quit lifecycle, `src/main/ozone.ts`, `loginPath.ts`, tray | `App.tsx` close handling only |
| W2-A | `handover.ts`, new `exec/plannerStart.ts`, `resources/skills/orchestration-guide.md`, new `resources/skills/planner-guide.md` | `types.ts` (Task fields), `command.ts` (planner guard), `NewRunModal.tsx`, `JobsView.tsx` / `lib/jobActions.ts` (approve button) |
| W2-B | new `src/renderer/src/components/workspace/*` | `App.tsx` (mount + plan selection state) |
| W2-C | new `src/core/orchestration/blocked.ts`, new `src/renderer/src/components/plan/*` | `RunDetail.tsx` (mount) |
| W2-D | new `src/core/github/taskLinks.ts`, `src/core/github/issues*.ts` | `types.ts` (`Task.links`), `command.ts` |
| W3-A | new `src/core/orchestration/activity.ts`, new `components/activity/*` | notifier wiring, workspace view mount |
| W3-B | new `src/core/intents/*`, new `components/command/*` | `App.tsx` (hotkey + mount, JobsView `onApprove`), keybindings, `lib/jobActions.ts`, `JobsView.tsx` (approve prop) |
| W3-C | new `src/core/orchestration/sessionIndex.ts`, new `components/search/*` | workspace sidebar mount, `command.ts` (`dispatches-list`) |
| W3-D | test files only (`*.test.ts`, e2e) + minimal bug fixes it finds, each fix described | — |
| W5-A | `exec/workerStart.ts`, `exec/coordinator.ts`, `exec/specFiles.ts`, `exec/integrateGit.ts`, the fork call in `exec/dispatchLoop.ts` | `src/host/spawner.ts`, `runChecks.ts` |
| W5-B | `command.ts` handlers `runs-resume` / `jobs-archive` / `run-start` / `tasks-list`, `lifecycle.ts`, `state.ts` run lookup, `cliArgs.ts`, `cliUsage.ts`, `blocked.ts` reasons | `planner.ts`, `exec/dispatchLoop.ts`, `exec/limitProbe.ts` |
| W5-C | `components/command/*`, `core/intents/*`, `schedule.ts`, `RunDetail.tsx`, `lib/jobActions.ts` | `types.ts`, `command.ts` (hold commands), `exec/dispatchLoop.ts`, `JobsView.tsx`, `core/host/*Gate.ts` |
| W6-A | `core/sources/objective.ts`, `core/github/issue.ts`, `core/github/issueSource.ts`, new `core/orchestration/intake.ts`, new `components/intake/*` | `command.ts` (`jobs-create` / `jobs-create-from-issue` args, `github-issue-assign`), `cliUsage.ts`, `cliArgs.ts`, `NewRunModal.tsx` / `JobsView.tsx` (mount), `planner.ts` (`validatePlan` basis check), `types.ts` (`Task.basis`), `planner-guide.md` ("Before you plan" section) |
| W6-B | `inbox.ts`, `resources/skills/orchestration-guide.md`, `src/main/desktopNotifier.ts`, `activity.ts` (new kinds), new `renderer/src/lib/alertSound.ts`, sound setting UI | `exec/workerStart.ts` (worker spawn args), `command.ts` (the `send --type escalation` branch), app-settings type |
| W6-C | `schedule.ts`, `blocked.ts`, `settings/maxConcurrentWorkers.ts`, `convergence.ts` | `types.ts` (`MAX_REVIEW_ROUNDS`), `exec/reviewGate.ts` |
| W6-D | new `core/orchestration/replan.ts`, new `exec/replanStart.ts`, `exec/plannerStart.ts`, `resources/skills/planner-guide.md` | `types.ts` (`Job.replan`), `schedule.ts` (one `waveOpen` filter call), `exec/dispatchLoop.ts` (boundary trigger), `activity.ts` (two kinds) |
| W6-E | `components/plan/*`, `core/hooks/sessionState.ts` (`lastActionOf`) | `src/host/sessions.ts` (carry `lastAction`), `RunDetail.tsx` / workspace mount, `core/types.ts` (`SessionInfo.lastAction`) |
| W6-F | `components/workspace/*` | `App.tsx` (project selection + per-project layout state), keybindings |
| W6-G | new `core/sessions/subagentCap.ts` + its hook script, `core/sessions/statusline.ts` (hook entries), new `core/orchestration/usageGuard.ts`, new `components/usage/*` | `exec/dispatchLoop.ts` (guard call), `blocked.ts` (one reason), `activity.ts` (two kinds), app-settings type, plan view mount |
| W6-H | new `core/orchestration/delivery.ts`, `exec/integrateGit.ts` (push path) | `types.ts` (`Project.delivery`, `deliveryBranch`, Run delivery result), `command.ts` (`projects-set`, `--delivery`), the Run completion path, project settings UI, `activity.ts` (`plan.delivered`) |
| W7-A | `lib/jobActions.ts`, new `components/plan/PlanTalk.tsx`, new `exec/plannerFeedback.ts` | `exec/plannerStart.ts`, `exec/replanStart.ts` (owner feedback input), `command.ts` (`jobs-feedback`, `jobs-reject`), `core/intents/*`, `types.ts` (`Project.autoApprove`, feedback history on the Job) |
| W7-B | new `core/projects/create.ts`, new `core/projects/detect.ts`, new `components/projects/*` | `types.ts` (Project fields), `command.ts` (`projects-create`, `projects-add`, `projects-set`), `core/worktrees/base.ts` (only if needed), W6-F switcher mount |
| W7-C | `inbox.ts`, `command.ts` handlers `ask` / `questions-*`, `resources/skills/orchestration-guide.md`, `src/main/desktopNotifier.ts`, `src/main/activityNotices.ts`, `core/sessions/attention.ts`, the answer box in `components/plan/*` (not `PlanTalk.tsx`) | `usageGuard.ts` (change listener), `exec/dispatchLoop.ts`, `components/workspace/*` (inbox row click), `src/main/index.ts` (`show`) |
| W7-D | `core/orchestration/intake.ts`, `components/intake/*`, `command.ts` handlers `jobs-create` / `jobs-create-from-issue` / `jobs-set` / `tasks-add`, `cliArgs.ts`, `cliUsage.ts`, `cliAgentContext.ts` | `RunDetail.tsx` (header control), `lifecycle.ts` (`jobNameOf`), `src/core/github/*` (PR title) |
| W7-E | `handover.ts` (planner brief), `resources/skills/planner-guide.md`, `replan.ts`, `exec/replanStart.ts`, `reviewer.ts`, `exec/reviewGate.ts` | `exec/plannerStart.ts`, `exec/dispatchLoop.ts`, `types.ts` (Job review default), `command.ts` (`jobs-plan` / `jobs-create` flag), `src/core/github/*` (no-remote message) |
| W7-F | tab strip + its `styles.css`, sidebar account panel, `HistoryBrowser.tsx`, `JobsView.tsx` layout, `components/plan/planBoard.ts` / `TaskBoard` | `App.tsx` (tabs, active session, auto-close), keybindings, `AccountSettings.tsx` (export unregister), `core/accounts` (email check, login URL), `components/workspace/workspaceTree.ts` |
| W8-C | `core/orchestration/intake.ts` (`--mode prompts`), `cliArgs.ts`, `cliUsage.ts`, `resources/skills/planner-guide.md`, `resources/skills/orchestration-guide.md` (worker brief lines, `astera heavy`), new `core/orchestration/heavyLock.ts` | `types.ts` (`Job.after`), `schedule.ts` / `blocked.ts` (one gate, one reason), `planner.ts` (`validatePlan` verbatim check), `command.ts` (`--after`, `heavy`), New flow source picker, USAGE.md, LINUX.md |
| W8-E | `command.ts` handler `worker-start` (and its hold refusal), `inbox.ts`, `activity.ts` (plan.done block) | `replan.ts` (`notStarted`), `exec/dispatchLoop.ts`, `src/main/activityNotices.ts`, `resources/skills/orchestration-guide.md` (one block marked W8-E) |
| W8-F | `exec/plannerFeedback.ts`, `components/plan/QuestionAnswer.tsx` + its `TaskBoard.tsx` mount, the approval toast, `command.ts` handler `questions-answer`, `reviewer.ts`, `exec/reviewGate.ts` | `src/main/ipc.ts` (route), `cliArgs.ts` / `src/cli/run.ts` (trim), `handover.ts`, `orchestration-guide.md` (one line), `components/plan/PlanTalk.tsx` |
| W8-G | `exec/integrateGit.ts` (default-branch fallback only), `src/core/github/taskLinks.ts`, `components/projects/*`, the project auto-registration site | `handover.ts`, `intake.ts` (one block marked W8-G), `App.tsx` (`projectAnchor`), `delivery.ts` (no-remote notice) |
| W8-D | new `core/orchestration/overlap.ts`, `schedule.ts` (cross-plan `editing` by project), `blocked.ts` (reason) | `types.ts` (`Job.overlaps`, `Job.areas`), `planner.ts` / `resources/skills/planner-guide.md` (other plans' Tasks in the brief), `replan.ts` (reads other plans), `command.ts` / `cliArgs.ts` / `cliUsage.ts` (`jobs overlaps`, `--areas`, `--area`), `activity.ts` (`plan.overlap`), JobsView approve area (one line per overlap) |
| W8-A | new `core/attribution/{note,stamp,remap,blame,stats}.ts` | `exec/integrateGit.ts` (stamp before merge, copy notes), `core/orchestration/delivery.ts` (push the notes ref, PR body block), `src/main/githubPrs.ts` (squash remap), `command.ts` / `cliArgs.ts` / `cliUsage.ts` (`attribution-blame`, `attribution-stats`, `attribution-why`) |
| W8-B | new `core/attribution/{lines,checkpoint,gitAi}.ts` + its hook script, new `components/attribution/*` | `core/sessions/statusline.ts` (hook entries), `core/attribution/stamp.ts` (one `lines` call), file viewer mount, plan view mount, project settings page (one row) |
| W9-0 | new `docs/orchestrator/DESIGN.md`, the mockup artifact | — (no code) |
| W9-A | new `src/renderer/src/styles/{tokens,base,primitives}.css`, bundled fonts under `src/renderer/src/assets/fonts/` (IBM Plex Sans, JetBrains Mono), the new mark in `assets/` and `build/` icons, new `components/ui/*` primitives (`Button`, `Chip`, `Card`, `Modal`, `Nav`, `Tabs`, `Menu`, `Field`, `Meter`, `EmptyState`, `Icon`), new `components/shell/*`, new `renderer/src/state/*` hooks moved out of `App.tsx`, `core/theme/themes.ts`, `lib/theme.tsx`, `ThemeSettings.tsx`, `tailwind.css` token map | `App.tsx` (moves only, no new behaviour), `styles.css` (sections cut out as they move), source-regex tests that follow moved code |
| W9-B | `components/shell/{TopBar,Pages,StatusBar,MoreMenu}.tsx`, `core/ui/pages.ts`, `components/workspace/*` (retired), `AccountPanel.tsx`, `AccountRow.tsx`, `AccountUsageMeter.tsx`, `HistoryBrowser.tsx`, `usage/*`, `core/ui/sidebar.ts`, `core/keys/binding.ts` (rail ids) | `App.tsx` (shell mount), `components/ui/*` (new variants only) |
| W9-C | new `components/pages/{TasksPage,PlansPage,PlanPage}.tsx`, `RunDetail.tsx` (moved into `PlanPage`, then deleted), `components/plan/*` except W7-C's answer box, `JobsView.tsx` (becomes `PlansPage`'s list), `lib/jobActions.ts` | `App.tsx` (mount) |
| W9-D | `activity/*`, `search/*`, `command/*`, `conversation/QuestionCard.tsx`, W7-C's answer box, new `components/inbox/*` | `App.tsx` (rail badge, hotkey), `core/intents/*` (open-plan intent) |
| W9-E | new `components/pages/StartPage.tsx` (the composer: Plan it for me / Run as written), new `components/settings/*` (one file per group), every dialog listed in DESIGN.md "Dialogs" moved onto `ui/Modal`, `NewSessionDialog.tsx` / `NewRunModal.tsx` / `intake/*` / `SourceJobModal.tsx` (one New flow), `components/projects/*` page | `App.tsx` (Settings block deleted, `<SettingsDialog/>` mounted) |
| W9-H | new `components/pages/AgentsPage.tsx`, `components/wall/*`, `PaneGrid.tsx` / `TerminalView.tsx` (tile mode: small font, read-only until opened, offscreen pause; the full-size console), `conversation/*` (stop offering it for new consoles), new `core/sessions/ownerHold.ts`, the `sessions-send` handler in `command.ts` and `src/host/orch.ts` (queue while held) | `src/host/sessions.ts` (owner-input timestamp), `App.tsx` (mount the pinned tab), `resources/skills/orchestration-guide.md` (one line: a queued send is not a failure) |
| W9-I | new `core/sessions/summary.ts` (facts + prompt), new `src/host/hostSummaries.ts`, `components/wall/SummaryCard.tsx` | `core/understanding/*` (reuse the generator call), `src/host/sessions.ts` (end hook), `core/orchestration/delivery.ts` (PR body roll-up), `components/plan/*` card (one row, after W9-C: coordinate in the PR), `HistoryBrowser.tsx` (one row), app-settings type (`tabSummaries`) |
| W9-J | `WorktreePanel.tsx` (becomes the Worktrees page list), new `components/pages/WorktreesPage.tsx` + `components/worktrees/*` (detail, `worktreeView.ts` store), new `core/worktrees/{cleanup,cleanupRun,detail}.ts` (ready-to-remove rule, git facts and removal, the detail's git reads; auto-clean after delivery) | `core/worktrees/{list,remove}.ts` (read-only reuse, no change), `core/orchestration/{delivery,command}.ts` (`cleanAfterDelivery` called from `run-deliver`; optional dep `cleanWorktrees`), `src/host/{index,orch,orchDeps,worktrees}.ts` (the Host injects `cleanWorktrees`), app-settings (`autoCleanWorktrees`: `appSettingsStore`, `core/settings/autoCleanWorktrees.ts`, IPC, preload), IPC `worktrees.{overview,cleanup,detail,fileDiff}`, `state/useNavigation.ts` (`openWorktree`), `shell/{Sidebar,Overlays}.tsx` (one mount each), `tsconfig.web.json` (one include) |
| W9-K | new `src/main/windows.ts`, `src/main/index.ts` window lifecycle (`mainWindow` → window set, `second-instance` argv, tray project list) | IPC push sites that targeted `mainWindow` (send to all windows), `components/workspace/ProjectSwitcher.tsx` ("Open in new window" item), keybindings, desktop file action, USAGE.md |
| W9-F | any renderer file, for fixes found by the walk-through; each fix listed in the PR | — |
| W9-G | `README.md`, deleted `README.{ko,ja,es}.md`, `docs/*.md` outside `docs/orchestrator`, new `docs/dev/` (wave prompts move here), `assets/*` screenshots, `package.json` `description` / `homepage` | `docs/orchestrator/USAGE.md` (becomes `docs/guide.md`) |
| W10-A | `core/orchestration/intake.ts` (name resolution, prompts-folder detection), the Start page's source line and "Next waves" button | `types.ts` (project `promptsDir`), `command.ts` / `cliArgs.ts` / `cliUsage.ts` (`projects set --prompts-dir`), project settings page (one row), user guide |
| W5-D | `activity.ts`, `components/activity/*`, `sessionIndex.ts`, `components/search/*`, `src/main/activityNotices.ts`, `src/main/remote/orchRouter.ts` | `src/host/index.ts`, `src/host/sessions.ts`, `src/main/ipc.ts`, `types.ts` |

## Wave 6 — Autopilot (owner request 2026-10-18)

Goal: give Astera a plan source and extra instructions, and it runs the plan to done with as little babysitting as
possible.
- **Sources:** a PDF, "audit X", a pasted problem list, or GitHub issues.
- **The flow:**
  1. The planner makes the plan deeper: tasks, affected files and waves.
  2. Up to 10 worker tabs open, but never two tabs on the same files at once.
  3. The coordinator answers the workers' questions.
  4. A fresh reviewer checks each finished task.
  5. Before each next wave, the planner is asked again to adjust the rest of the plan to what really happened.
  6. A final check runs before the plan is called done.
- **When the owner hears from it:** only for a real owner decision, a permission prompt, or a give-up. Each one
  comes with a sound and a desktop notice.
- **What the owner sees:** a plan view showing the waves, each task's files, and what each tab is doing right now.
  Projects such as gameful each open as their own workspace with their own tabs.

### Wave 6 contracts (shared names; every tab uses them exactly)
- Activity kinds:
  - `question.auto-answered`: feed only, no notice. Owned by W6-B.
  - `task.escalated`: notice and sound. Owned by W6-B.
  - `plan.replanning` / `plan.replanned`: feed. Owned by W6-D.
- Wave of a Task: its dependency depth, `waveOf(task, tasks)` in `replan.ts` (W6-D). It is 0 for a Task with no
  deps, else 1 + the max of its deps' waves. W6-E imports it. Until W6-D merges, W6-E carries an identical local copy
  marked `shortcut: replace with replan.waveOf after W6 merge`.
- `SessionInfo.lastAction?: { tool: string; target?: string; at: number }`, from the last `PreToolUse` hook (W6-E).
- `Task.basis: { state: 'missing' | 'partial' | 'broken'; evidence: string }`, required by `validatePlan` (W6-A).
  Activity kind `plan.nothing-to-do` (W6-A).
- `Project.delivery?: 'pr' | 'push'` (missing = `'pr'`), `Project.deliveryBranch?`, Job override; activity kind
  `plan.delivered` (W6-H).
- App setting `alertSound: boolean`, default true (W6-B).
- App settings `maxSubagentsPerSession` (default 10, 1–10) and `usagePauseAt` (percent, default 90) (W6-G).
- Activity kinds `usage.paused` / `usage.resumed`: feed and notice, no chime. Owned by W6-G.
- Job field `replan?: 'waves' | 'off'`, default `'waves'` (W6-D).

### Owner decisions and Claude's calls (2026-10-18)
- Owner:
  - Up to 10 tabs.
  - The orchestrator answers questions; the owner is called only when it is unsure, with a sound.
  - Same-file tasks never run in parallel.
  - A reviewer checks each task.
  - Replan between waves.
  - Plan and progress view.
  - Per-project workspaces.
  - GitHub assign-me plus issues into a plan.
  - Usage limits: at most 10 subagents per tab.
  - Before planning, check what is already built (code, GitHub issues and PRs, other Jobs) and follow the repo's
    GitHub rules. Already built means: look for issues and plan fixes; nothing is built twice.
- Claude's calls (the owner can override any):
  - **PDF:** no parser. The PDF is copied into the plan's spec folder, and the planner reads it with Claude's own
    file reader, which reads PDFs. A PDF over 20 pages is read in page ranges.
  - **Review rounds:** default raised from 2 to 5. After the cap, the Task escalates with a sound instead of waiting
    silently on a Gate.
  - **Auto-answers:** the coordinator's answers are visible in the feed and on the task. They never notify.
  - **Permission prompts stay human.** The security rule in `sessions-send` stays. Workers are spawned so their
    *questions* go through `astera ask` (Claude's `AskUserQuestion` tool is disallowed for workers), which the
    coordinator can answer.
  - **Final check:** after the last wave, one completion pass compares the result with the objective. It may add at
    most 3 follow-up waves before it must escalate.
  - **Usage pause:** no new worker starts on an account at 90% or more of its 5-hour or 7-day limit, unless
    rolling has a fresher account. Running work is never stopped.
  - **Coordinator model:** stays haiku, per the 2026-10-17 decision. If auto-answers are poor, switch the coordinator
    role to sonnet in Settings; no code change is needed.

## Wave 7 — Talk to the plan, every project (owner request 2026-10-18)

**Principle: automate as much as possible.** Astera waits for the owner only for:
- plan approval, and only when the project has not turned on auto-approve
- an owner decision, an escalation or a permission prompt
- anything outward-facing that was not set up beforehand (creating a GitHub repo, pushing a project that is not set
  to `push`)

Everything else runs on its own.

- **W7-A:**
  - At approval, the owner can talk to the planner (the same Claude session is resumed) until the plan is right,
    reject it with a reason, or set auto-approve per project.
  - The same feedback box works mid-run through the W6-D replan.
- **W7-B:**
  - Astera works for new projects (create, `git init`, initial commit, optional GitHub repo) and for existing ones
    (add, detect the test command).
  - Each project gets one settings page: delivery, auto-approve, test command, concurrency, review rounds,
    replan, account.

Contracts:
- `Project.autoApprove?: boolean` (W7-A)
- commands `jobs-feedback` / `jobs-reject` (W7-A)
- commands `projects-create` / `projects-add` / `projects-set` (W7-B)
- W7-B's settings page mounts W7-A's toggle

W6-V fixes (issues #67–#84, filed by the dogfood on 2026-10-18), in the same wave:
- **W7-C:** the owner answers escalations and `astera ask` questions from the card, the inbox and the CLI; the
  coordinator stops blocking in sleep loops and hears `usage.resumed`; the escalation chime; finished turns read idle.
- **W7-D:** plans from a source get a real name; the New plan dialog has a worker count and `jobs-set` changes it
  later; `tasks add --affected-paths`.
- **W7-E:** a reviewer for every planned Task; exactly one final check per plan; fixlist and audit planners write
  `existing.md`; no-remote PR message.
- **W7-F:** ended plan tabs close on their own, a tab overflow menu and quick switcher; add an account with a login
  link, remove it from the sidebar; collapsible History; account relabel after a re-login; sidebar and board fixes.
- W7-D's dialog field reads W7-B's per-project concurrency default once both are merged. W7-C's answer box and
  W7-A's `PlanTalk.tsx` both live in `components/plan/`: separate files.

## Wave 8 — Who wrote this (owner request 2026-10-18)

Goal: many agents commit and merge in parallel, and the owner can still answer, for any line, commit, PR or plan:
human or AI? Which agent, model and account? Which Job, Task and session, and what was it asked to do? The bar is
[git-ai](https://github.com/git-ai-project/git-ai) (Apache-2.0), which does this for single agents through agent
hooks, Git Notes, and rewrite tracking.

**What Astera already has that git-ai has to reconstruct:**
- Every worker runs in its own worktree, on its own branch, for one Task. It is spawned with a known session,
  model and account (W5-A, `exec/workerStart.ts`). So each worker commit is already 100% one agent.
- Astera makes its own merges and cherry-picks (`exec/integrateGit.ts`) and its own delivery (W6-H), so it
  writes those commit messages itself.
- EG §26 attribution windows (`core/workUnit/collector.ts`) already know when a session is busy and when Astera
  itself moves HEAD.
- `taskMarker` (`core/github/taskLinks.ts`) already ties Tasks to issues and PRs. The GitHub PR poll
  (`src/main/githubPrs.ts`) already sees when a PR is merged.

**What is missing:**
- Nothing is written into git. When a worktree is removed, the link from a commit to its Task is lost.
- There is no line-level split when a human and an agent edit the same commit. This happens on `runCwd`
  and in interactive tabs.
- Nothing survives a GitHub "Squash and merge".
- There is no blame or stats view.

**Split:**
- **W8-A** writes commit-level attribution. It is native, always on, and has no dependency.
- **W8-B** adds line-level attribution and the UI. It begins with a spike that decides whether to use git-ai or a
  native engine.
- Both prompts use the note contract below, so they can run in parallel.

### Wave 8 contracts
- Notes ref `refs/notes/astera`. It holds one JSON note per commit:
  `{ v: 1, tool: 'astera', job, task, session, agent: 'claude' | 'codex', model, account, role: 'worker' | 'coordinator' | 'reviewer' | 'planner', human?: true, lines?: { [path]: [start, end][] } }`.
  - `lines` missing means the whole commit is AI. W8-B fills `lines` only for mixed commits.
  - `account` is the account id label. It is never an email or a token.
  - Prompts never go into git. They stay in Astera's local store, which already keeps sessions. The note carries
    ids only, so `attribution-why` can open the session.
- Repo config, set by Astera on every project it manages, so git itself carries notes through amend and
  rebase:
  - `notes.rewriteRef=refs/notes/astera`
  - `notes.rewrite.amend=true`
  - `notes.rewrite.rebase=true`
- Commit trailers on every commit Astera writes itself (integration merges, delivery commits, and squash bodies):
  `Astera-Job:`, `Astera-Task:`, `AI-Agent: <agent>/<model>`. Trailers survive squash. Notes do not.
- Stats JSON field names match git-ai's names: `human_additions`, `ai_additions`, `ai_accepted`,
  `git_diff_added_lines`, `git_diff_deleted_lines`, `tool_model_breakdown`. Tooling can then read both.
- Commands `attribution-blame <file>`, `attribution-stats [<range>] [--json]`, `attribution-why <sha | file:line>`
  (W8-A). CLI: `astera blame`, `astera stats`, `astera why`.

### Parity with git-ai (what "as good as" means here)
| git-ai | Wave 8 |
|---|---|
| Agent reports its own lines (`git-ai checkpoint`) | W8-A: commit level from the spawn itself. W8-B: lines from Edit/Write hooks, or git-ai if the spike picks it |
| Notes survive rebase, amend, stash, cherry-pick, merge, reset | Native `notes.rewriteRef` for amend and rebase. Astera copies notes itself on its own merges and cherry-picks |
| Squash-merge on GitHub needs Teams or a CI action | No CI needed. On PR merge, Astera remaps notes onto the squash commit from its stored Task-to-commits map (W8-A) |
| `push` / `fetch` sync notes | W6-H delivery pushes `refs/notes/astera`. Project add (W7-B) adds the fetch refspec |
| `git ai blame`, `git ai stats` | `astera blame` / `stats` / `why`, plus a blame gutter in the file viewer (W8-B) |
| Prompts kept local and redacted | Prompts are never in git. They stay in the existing session store |
| Not covered: `git mv`, `filter-repo`, `replace` | Same limits. `git mv` lines are shown as unknown, never as human |

### Claude's calls (the owner can override any)
- **Native first.** Commit level needs no new tool, because Astera already knows the author. Line level reuses
  git-ai only if the W8-B spike passes.
- **Never install git-ai automatically.** Its installer is `curl | bash` and edits global agent hooks. If the
  spike picks git-ai, Settings shows it as detected or not installed, plus the install command. The owner runs it.
- **The notes ref is outward-facing.** It is pushed only as part of a delivery that the owner already set up
  (W6-H). Notes carry no prompt text, emails or paths outside the repo.

## Running the waves in Astera (from Wave 8 on)

Up to Wave 7, every wave ran by hand: one Claude tab per prompt, then `MERGE.md` in one more tab. The W6-V dogfood
showed that Astera already does each step of that for one plan:
- the planner splits the work, and workers run in parallel worktrees;
- two Tasks never run at once on the same files;
- a reviewer checks each Task, and a final check runs at the end;
- Astera merges the Tasks itself and delivers.

The W7 fixes (#70 reviewer, #72/#73 answering and the blocking coordinator, #74 one final check) close the gaps it
found. **W8-C (with W8-E, the 7V re-run's coordinator fixes) is the last wave run by hand.** It adds three things:
- prompt files become Tasks verbatim;
- a plan can wait for another plan;
- heavy jobs (full suite, dev app, AppImage build) take one machine-wide slot.

From then on, each wave is one Astera plan, queued after the one before it. Run these from the packaged app's
profile, never the dev profile:

In the app: **Start → Run as written**. Attach every W8, W9 and W10 prompt (W8-A, B, D, F, G, W9-A … K, F, G and W10-A; W9-0 is done),
set delivery to PR, and press Start. The planner reads PLAN.md's wave table and builds the order:
1. W8 (A, B, D, F, G in parallel).
2. W9-A alone.
3. W9-B, C, D, E, H, I, J, K in parallel.
4. W9-F.
5. W9-G.
6. W10-A.

The approval shows that order once. After that, one draft PR is updated after every wave and marked ready at the
end. The same from the CLI:

```bash
J=$(astera jobs create --mode prompts --delivery pr --coordinator-account "$A" --concurrency 8 \
  $(printf -- '--attach %s ' docs/orchestrator/prompts/W8-{A,B,D,F,G}-*.md) \
  $(printf -- '--attach %s ' docs/orchestrator/prompts/W9-{A,B,C,D,E,H,I,J,K,F,G}-*.md) \
  $(printf -- '--attach %s ' docs/orchestrator/prompts/W10-A-*.md) | jq -r .data.id)
astera jobs plan --id "$J"
```

(USAGE.md "Running the waves in Astera" has the full commands, `$A` included.)

Separate queued plans per wave (`--after <job>`) still work, if the owner wants one PR per wave.

**Later (owner request 2026-10-18; planned as `W10-A-run-by-name`): no attaching.** Today the owner attaches every
prompt file and pastes the order (`RUN-W8-W9.md`) into Instructions. The owner wants to give only the text: "run W8-A,
B, D, F, G, then W9 …". In Run as written, Astera then resolves each named prompt from the project's prompts folder
(`docs/orchestrator/prompts/<id>-*.md`, or a folder set per project). Each resolved file becomes a Task verbatim, as if
attached, and the approval lists the file each name resolved to. A name that matches no file, or more than one, is
refused before planning, saying which. Later still: "run the next waves" reads PLAN.md's wave table and picks every
prompt not yet done.

The owner's part:
- Answer what lands in the Inbox: real questions, plan approvals unless the project auto-approves, and permission
  waits.
- Review each wave's PR. W8-C keeps delivery as a PR for this repo; switch the project to `push` once the waves are
  trusted.
- `MERGE.md` is no longer needed for these waves, because Astera's integration merge does that job.

## Wave 9 — Redesign (owner request 2026-10-18)

Goal: Astera is no longer "many terminals plus Jobs". It is an orchestrator: projects, plans, workers, questions,
review and delivery. The UI and the docs still show the old product. Wave 9 redesigns both, so every feature from
Waves 1–8 has one clear place, and the app looks like one product.

### What is wrong today (survey of `src/renderer`, 2026-10-18)
- **One plan, two meanings.** From the Jobs sidebar a plan opens `RunDetail`, a modal. From the Workspaces tree it
  filters the pane grid. The richest view in the app (board, graph, files, journal, diffs, gates) is a modal that
  cannot sit beside the terminals.
- **The urgent thing is the smallest.** Questions, escalations and permission waits are a number badge in the
  Workspaces header. The feed is a separate panel.
- **The sidebar is a stack of six panels:** switcher, accounts, workspaces with search, activity, worktrees and
  history. Collapse state is not kept. History and Accounts cannot collapse at all.
- **Usage is drawn four ways:** status bar chips, account rows, the Run strip and the settings.
- **Settings has 16 flat tabs.** Several are inline JSX in `App.tsx`. Voice, worker cap, usage guard, models and the
  agent browser all sit under "Agent".
- **Three "new" flows:** `NewSessionDialog`, `NewRunModal`/`NewPlanDialog`, and `SourceJobModal`.
- **No design system.**
  - `App.tsx` is 5,882 lines, with about 110 `useState` calls.
  - `styles.css` is 3,291 lines, with 136 hard-coded colours.
  - There are 16+ badge/chip classes and 5 separate card styles.
  - About 20 dialogs each hand-roll `.modal-backdrop`. `components/ui` is used only by the vendored assistant-ui.
  - Icons mix lucide with hand-drawn SVGs. Tailwind leaks into app components.
  - All 7 themes are dark, and there is no light mode.
- **The README and docs describe upstream Astera**, with fork status tables bolted on. The translations are
  upstream's and stale.

### Hands-off first (owner, 2026-10-18)

The owner's words: "the goal is to have stuff as automated as possible … i want a way to see all cli tabs, this is
the most important part, and interact with them as needed without interrupting the main claude tab that is working
on all of them … each tab a small summary when done … very hands off".

This puts three things at the centre of Wave 9:
- **The Agents wall** (W9-H) is the default view. It shows every CLI tab of the project live, in one grid.
  - Clicking a tile takes it over and types straight into it.
  - A "Send a line" box answers without taking over.
  - While the owner holds a tab, the coordinator's messages to that tab are queued in the Host. They are never typed
    into the owner's line, and the coordinator is never blocked.
- **Tab summaries** (W9-I): every tab that ends leaves a short card that says what it did, its files and checks, its
  review, and its questions. A plan's cards roll up into its Overview and its PR body.
- **Nothing interrupts the owner** except the Inbox: approvals that are not automatic, real questions, permission
  waits and give-ups.

### The new layout and look

[DESIGN.md](DESIGN.md) is the spec, and the clickable mockup is https://claude.ai/artifact/DhSiAPZxCigXD4xJBoFb9x.
In short:

```
┌ ◆ Astera / gameful ⇅   Agents  Tasks  Plans  Inbox 2  Worktrees  Files     [Search ⌃⇧K] [+ New] │ ▮▮▯ ⚙ ┐
│ ─────── (underline on the active page)                                                                │
│ All consoles │ Coordinator │ Worker 2 · T4 │ Worker 3 · T5 │ Reviewer │ Planner                        │
│ ┌ Worker 2 · T4 ── Permission ┐ ┌ Worker 3 · T5 ── Asks you ┐ ┌ Coordinator ── Watching ┐               │
│ │ real Claude Code console    │ │ real console              │ │ real console             │  …          │
│ └─────────────────────────────┘ └───────────────────────────┘ └──────────────────────────┘               │
│ Finished · what each console did: [summary] [summary] [summary]                                       │
├ ● 6 consoles · 4 working   ● 2 waiting for you   Next: Redesign 9.1 after Leaderboard API   jip 42%  ┤
```

- **Pages, not panels.** A 44px top bar with plain text tabs replaces upstream's icon rail and stacked sidebar, so
  the consoles get the full width. The pages are:
  - **Start**: where a plan is dropped. Shown for an empty project, or from New. Two modes: "Plan it for me" or
    "Run as written".
  - **Agents** (default): every console live, and a full-size console on click.
  - **Tasks**: a board of every Task across plans.
  - **Plans**: a list, then a plan page with Overview, Waves, Files, Changes and Journal.
  - **Inbox**: Needs you, and Handled for you.
  - **Worktrees**.
  - **Files**.
  - **Settings**.
  - **More ▾**: History, How It Works, Browser, Run configs.
- **Consoles are the real CLI** (the xterm itself), never a custom chat or input box. Slash commands, permission
  prompts and plan mode just work. The owner types in the console. The coordinator's messages to a console the
  owner holds are queued until they leave it.
- **Plans side by side** (W8-D data, W9 UI):
  - The Agents page filters consoles by plan, using the plan pills in its toolbar. Each plan's coordinator is
    pinned first.
  - The Plans page groups plans by area and has an **Overlap** view showing which plan works where.
  - The Inbox approval card warns about overlaps, with "Start after" and "Move into".
- **A new product look**, not upstream's:
  - Themes Night (lime), Dusk (lavender) and Day (olive).
  - IBM Plex Sans and JetBrains Mono, bundled.
  - A new mark.
  - Quiet, flat chrome.

### Wave 9 contracts
- Navigation goes only through `navigation.ts` (W9-A stubs): `openPage(id)`, `openConsole(sessionId)` (W9-H),
  `openPlan(jobId, section?)` (W9-C), `openInbox(filter?)` (W9-D), `openWorktree(path)` (W9-J), and
  `openSettings(group, anchor?)` (W9-E).
- Owner hold: `ownerHold.ts` exports `isHeld(sessionId, now)`, with a 60 s idle timeout. `sessions-send` into a held
  session answers `{ queued: true, reason: 'owner-typing', target }`, and the Host delivers queued messages in order
  on release (W9-H).
- `SessionSummary { sessionId, jobId?, taskId?, at, outcome, durationMs, facts, text, model }`, read through
  `sessions-summary <id>` and the `summaries` list command. App setting `tabSummaries: boolean`, default true (W9-I).
- Page ids `agents | tasks | plans | inbox | worktrees | files | settings` (+ `more:history|hiw|browser|runs`) in
  `core/ui/pages.ts` (W9-A; replaces `core/ui/sidebar.ts`). Every saved `sidebarPane` maps to `agents`, except
  `explorer`, which maps to `files`.
- The source-regex tests listed in DESIGN.md "Pinned tests" keep their invariant. A prompt that moves pinned code
  updates the test's path or selector in the same commit. It never deletes the pin.

### Order and why
- **9.0** was drafted early (2026-10-18): DESIGN.md and the mockup exist, and the before-screenshots still need to be taken. It is one tab and changes no code. It writes `DESIGN.md` and builds a clickable mockup artifact of the
  layout, the Plan tab, the Inbox, New and Settings, in dark and light. The owner may comment on it; silence counts as approval, so
  Wave 9 never waits on the owner.
- **9.1 runs alone.** W9-A cuts `App.tsx` into `components/shell/*` and `state/*` hooks. It moves `styles.css`
  into tokens, base and feature files, and adds the primitives. Running it alone keeps parallel tabs from
  conflicting on `App.tsx`. Behaviour does not change: the full suite passes unchanged except for path updates in
  pinned tests.
- **9.2 runs as 6 parallel tabs on separate files:** shell and navigation (B), the Plan tab (C), Inbox and command
  (D), Settings page, dialogs and New (E), the Agents page and owner hold (H), console summaries (I), the Worktrees page
  (J), and a window per project (K). They meet only through the `navigation.ts` contract.
- **9.3** is one tab. It walks every surface in all 4 themes at the default and the narrowest sidebar width. It
  fixes what it finds, checks keyboard paths, and takes the screenshots.
- **9.4** is one tab. It rewrites the README and docs from the finished app, using 9.3's screenshots.

### Claude's calls (the owner can override any)
- **Diverge from upstream** (owner, 2026-10-18). Wave 9 restructures upstream files freely. Upstream fixes are
  cherry-picked by hand after this, and no longer merged.
- **Behaviour stays.** Wave 9 changes where things are and how they look, not what they do. Bugs found on the way
  get an issue and go into the next wave, unless they block the redesign.
- **No new UI framework.** React, the existing CSS and lucide stay. shadcn primitives under `components/ui` are
  reused where they fit. Tailwind is not spread further.
- **The terminal engine is untouched:** xterm, the PTYs and PaneGrid splitting. Only the chrome around consoles
  changes, and consoles show the CLI exactly as it is.
- **README is English only** (owner, 2026-10-18). `README.{ko,ja,es}.md` are deleted. The app's i18n stays.

## Explicit non-goals / limits
- No new terminal manager, account manager, or issue tracker.
- No combining of provider quotas. Account rolling stays exactly as the user configured it.
- Voice: interface + push-to-talk + a pluggable provider. The speech engine choice (local Whisper vs
  cloud) is the owner's call when W3-B starts.
- Attribution (Wave 8): no cloud dashboard, no prompt upload, no tracking through `git mv`, `filter-repo` or
  `git replace`.
- Upstream sync: until Wave 9, manual (`git fetch upstream && git merge upstream/main`). From Wave 9 on, the fork
  diverges (owner, 2026-10-18): upstream fixes are cherry-picked by hand, never merged wholesale.
- Redesign (Wave 9): no new UI framework, no change to the terminal engine or pane splitting, no behaviour change.

## Owner decisions (2026-10-17)
- Flow: talk to a coordinator, which creates a planner terminal (Claude, premium). The planner produces
  tasks and prompts. On approval, the orchestrator opens as many worker terminals as needed (Claude or
  Codex).
- Accounts: Claude only now, Codex later. Provider choice is limited to providers that have accounts.
  Review falls back to the same provider on a different, stronger model.
- Models: mixed. The planner rates each task's difficulty and that maps to a model:
  - light → haiku
  - standard → sonnet
  - hard → opus
  - planner and reviewer: opus
  - coordinator: haiku
  All of these can be overridden.
- Delivery: one PR per plan, never auto-merged. **Updated 2026-10-18:** chosen per project. gameful (unreleased)
  pushes straight to `main` after review, the final check and validation pass. Other projects, and gameful after
  release, use a PR. Missing setting = PR.
- Voice: local whisper.cpp. Audio stays on the machine.
