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
- Delivery: one PR per plan, never auto-merged.
- Voice: local whisper.cpp. Audio stays on the machine.
