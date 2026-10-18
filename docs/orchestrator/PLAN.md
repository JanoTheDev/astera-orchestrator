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
| 0 | 1 | `W0-linux-baseline-and-security.md` | — |
| 1 | 4 | `W1-A-role-models`, `W1-B-global-scheduling`, `W1-C-plan-lifecycle`, `W1-D-linux-background` | W0 merged |
| 2 | 4 | `W2-A-planner-stage`, `W2-B-workspace-sidebar`, `W2-C-plan-board`, `W2-D-github-links` | W1 merged |
| 3 | 4 | `W3-A-activity-feed`, `W3-B-command-and-voice`, `W3-C-search-and-inbox`, `W3-D-routing-recovery-tests` | W2 merged |
| 4 | 1 | `W4-final-linux-verification.md` | W3 merged |
| 5 | 4 | `W5-A-worker-spawn-and-worktrees`, `W5-B-run-lifecycle-and-cli`, `W5-C-holds-and-command-bar`, `W5-D-feed-inbox-and-runtimes` (W4's issues #38–#53) | W4 merged |
| 6 | 8 | `W6-A-intake-and-github`, `W6-B-autopilot-answers-and-sound`, `W6-C-scheduler-guards`, `W6-D-wave-replanning`, `W6-E-progress-view`, `W6-F-project-workspaces`, `W6-G-usage-guards`, `W6-H-delivery-modes` (Autopilot, see below) | W5 merged, **including PR #57** |
| 7 | 2 | `W7-A-plan-feedback`, `W7-B-projects` | W6 merged |
| 7V | 1 | `W6-V-autopilot-dogfood.md` (covers W6 and W7) | W7 merged |

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

## Explicit non-goals / limits
- No new terminal manager, account manager, or issue tracker.
- No combining of provider quotas. Account rolling stays exactly as the user configured it.
- Voice: interface + push-to-talk + a pluggable provider. The speech engine choice (local Whisper vs
  cloud) is the owner's call when W3-B starts.
- Upstream sync: manual (`git fetch upstream && git merge upstream/main`) whenever the owner wants it.

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
