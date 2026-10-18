You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, docs/orchestrator/LINUX.md, docs/orchestrator/USAGE.md and the SPEC.md sections named below.
Then read each GitHub issue named here (`gh issue view <n> -R JanoTheDev/astera-orchestrator`: it has the repro and a
fix idea) and inspect the existing code it names before writing anything. Extend existing code; do not build parallel
systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w5-feed`, branch `fix/orch-feed-inbox`.

SPEC sections: §9, §12.

# W5-D — Feed timing, waiting workers, Slack and remote Runtimes

Fix:
- **#48** "Plan ready for your approval" fires when the planner starts. In `core/orchestration/activity.ts` emit
  `plan.awaiting-approval` when the planner's turn ends with Tasks present and `validatePlan` passing, not on the
  `plannerSessionIds` transition. One line and one notice per plan.
- **#42** A worker waiting for input is not a feed line, and the inbox is empty while the app is closed. Derive a
  `task.waiting` event in the Host from the session's hook state (`core/hooks/sessionState.ts`, `sessionStateOf` in
  `src/host/sessions.ts`) with `reason: 'permission' | 'question'`; have the inbox read it from the Host and show
  the reason. Throttle like the other notices.
- **#43** Activity notices and digests skip Slack when the app keeps Slack. In `src/main/activityNotices.ts` post
  through the app's `SlackNotifier.postNotice` when the app is the Slack keeper, same throttle, never both processes.
- **#44** Feed, inbox and search read only the local Host. Route `activity-poll`, `activity-summary` and
  `dispatches-list` through `src/main/remote/orchRouter.ts` per Runtime (as `list` is) and merge the pages, tagging
  each item with its runtime. No paired Runtime on this machine: test with the router's existing fakes.

Ownership: `activity.ts`, `components/activity/*`, `sessionIndex.ts`, `components/search/*`, `src/main/activityNotices.ts`,
`src/main/remote/orchRouter.ts`. Additive: `src/host/index.ts` (activity wiring), `src/host/sessions.ts`,
`src/main/ipc.ts`, `types.ts`.

## Done means
- Every issue above fixed and covered by a regression test that fails without the fix (or, where the issue says so,
  the limitation explained in the PR with the smallest extension).
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator; its body says `Fixes #<n>` for each issue.
  Do not merge.
