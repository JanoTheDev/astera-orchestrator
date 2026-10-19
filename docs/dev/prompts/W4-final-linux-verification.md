You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md, docs/dev/LINUX.md, and the SPEC.md sections named below. Then inspect
the existing code named here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w4-final`, branch `chore/final-linux-verification`.

SPEC sections: all, especially §11 and §10.

# W4 — End-to-end verification on Linux

Run ALONE after Wave 3 is merged (PRs #34–#37 are in `main`). Nothing else may run the app, `dist:linux` or a full
suite while you do: you share the dev profile `~/.config/astera-dev` and its Host (CONTEXT rule 7).

## What Wave 3 shipped (use these; don't re-derive them)
- **Activity feed (W3-A).** `core/orchestration/activity.ts` (`deriveActivity`, `summarize`, `noticeOf`, throttle). The
  Host keeps it in `<profile>/orch/activity.jsonl` (a second `createHostEventLog`), read by the Host commands
  `activity-poll` / `activity-summary` (default window 15 min). UI: the **Activity** panel under the Workspaces
  sidebar (open plan's feed, "All plans" toggle, "Last 15 min" summary). Notices: desktop (Settings → Notifications →
  "Orchestration updates") and the Host's Slack (`SlackNotifier.postNotice`); digest every `activityDigestMinutes`
  (default 30, 0 = off).
- **Search + needs-input inbox (W3-C).** `core/orchestration/sessionIndex.ts`; search box and needs-input badge in the
  Workspaces header (`components/search/SessionSearch.tsx`); new read `dispatches-list [--run]`.
- **Command bar + voice (W3-B).** `core/intents/*`, `components/command/*`. **Ctrl+Shift+K** opens the bar,
  **Ctrl+Shift+M** push-to-talk (local whisper.cpp; nothing is downloaded — voice is only testable if the owner has
  installed a whisper.cpp binary and model, see `USAGE.md`). Confirm-class intents (approve, pause / stop-launching,
  archive, delete, merge) always go through the app's confirmation dialog; a voice transcript never starts one.
  "Approve & execute" in the Jobs view is its own `onApprove` → `approvePlan` (asks first).
- **Tests (W3-D).** Routing, restart-recovery, churn/caps and A ∥ B → C are covered **in-process**; there is no
  real-process Host e2e (see step 3). Bug fixed: an MCP client can no longer approve a plan (`run-start` refuses
  `role === 'mcp'`).

## Known gaps from Wave 3 (verify each; file an issue for each one that still holds)
1. No per-worker pause: only `worker-stop` (kills the session). "Pause worker 2" must **ask/clarify**, not act.
2. No non-destructive "stop launching" for a non-scheduled plan: `run-pause` refuses ("not scheduled"); the bar's
   pause is `runs-stop` (closes workers and coordinator) behind a confirmation. Smallest extension: `Job.dispatchHold`.
3. The Run detail window's "Run" button sends `run-start` without the new confirmation.
4. Command-bar archive/delete only act on plans of the project the Jobs view has open.
5. "Worker waiting for input" is not an activity-feed line (desktop `inputNeeded` / Slack still notify it); the inbox's
   "waiting" comes from main's attention, so it is empty while the app is closed and cannot tell permission from
   question.
6. Activity notices skip Slack when the **app** keeps Slack (Host has no Slack SDK).
7. Feed, inbox and search read only the local Host, not paired remote Runtimes.

## Steps
1. Fresh `npm ci`, `npm run typecheck`, `flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2` — all
   green or each failure explained.
2. `npm run dev` (or `npx electron-vite dev --remoteDebuggingPort <fresh port>` to drive it over CDP) and walk the SPEC
   §11 milestone by hand in a scratch git repo with a few files. Keep it to two or three tiny tasks on the owner's
   real `claude` account. Workers stop at permission prompts unless the owner turned on "Run agents without permission
   checks" (CONTEXT rule 7): answer them, and check they show up in the needs-input badge.
   - Create the project and a plan; run the planner (`jobs plan`, premium model) and check the plan's Tasks carry
     prompt / acceptance criteria / affected paths / model reason.
   - Approve ("Approve & execute" → confirmation). Watch parallel workers start as real sessions in the plan's
     workspace; check each session header shows project / plan / task / model / branch.
   - Type into one worker (focus its terminal from the sidebar, and once via the command bar's `send`).
   - Stop and resume the plan (`runs-stop` / `runs-resume`, via the Jobs view or the bar → confirm) — no duplicate
     workers afterwards.
   - Close and reopen the app (LINUX.md "Closing the window"): the same worker pids, no new spawn, no Task dispatched
     twice, the activity feed still holds the lines from before the restart.
   - Activity feed: completed / failed / cancelled / awaiting-review lines with model and account; "Last 15 min"
     summary; a blocked Task shows its reason; one desktop notice per failure/plan-done/question/approval, no flood
     (fail several tasks at once: at most 3 notices a minute, the rest counted in the digest).
   - Search (`tw1`-style fuzzy match across projects) and the needs-input badge.
   - Command bar: "show progress on <plan>", "show all sessions needing my input", "pause worker 2" (expect a clarification, gap 1),
     "pause <plan>" (expect a confirmation that says it closes sessions, gap 2).
   - Clean up: `jobs archive --id <job> --kill-sessions`, remove the test worktrees and the scratch repo.
3. Optional, if time allows and nothing else runs: the real-process smoke W3-D described — a
   `src/host/orch.linux.e2e.test.ts` gated on `ASTERA_HOST_E2E=1` that starts `out/main/host.js` with
   `ELECTRON_RUN_AS_NODE`, a fake `claude` first on `PATH` that reports `worker_done` through the CLI shuttle, and a temp
   profile, then asserts A ∥ B → C. Needs a build first.
4. `npm run dist:linux`, run the AppImage, repeat a short smoke (one plan, one task, feed line, notice). Then end its
   Host with the close dialog's "End the kept sessions too".
5. Docs and issues: update `docs/dev/LINUX.md` with what you measured. `docs/guide.md` already
   exists (W3-B wrote the command-bar and whisper.cpp part): **extend** it into the day-to-day guide (plans, planner,
   approval, workspace, feed, inbox, search, bar, notifications and digest settings). File an issue in this repo
   (`gh issue create`) for every gap above that still holds and anything else broken, with repro steps.

Ownership: `docs/orchestrator/*`, new e2e/test files, and minimal bug fixes you find (each one described in the PR,
with a regression test).

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
