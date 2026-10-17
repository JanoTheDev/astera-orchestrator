You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, and the SPEC.md sections named below. Then inspect the existing code named
here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w1-global-sched`, branch `feat/orch-global-scheduling`.

SPEC sections: §3, §12 (scheduling across plans).

# W1-B — Global concurrency + plan priority

Today `slotsToFill` (`src/core/orchestration/schedule.ts`) fills ready Tasks up to each Job's own
`concurrency`; `createDispatchLoop` (`exec/dispatchLoop.ts`) ticks every 15 s.

Build:
- App-wide `maxConcurrentWorkers` (app settings; default = unlimited to preserve current behaviour).
- `Job.priority?: number` (append to `interface Job`; default 0, higher first).
- Extend `slotsToFill` (keep it pure) to allocate across all active Runs: respect each Job's own
  `concurrency` AND the global cap; order by priority, then fair round-robin among equal priority so one
  plan cannot starve others; never count paused / pendingStart / archived Jobs; count already-open
  Dispatches (incl. review/repair) against the cap.
- Verify (with tests) pausing one Job leaves other Jobs dispatching.
- Verify a task is only launched when every dep is `done` (not merely "dispatched"/"validating") and its
  environment is ready (worktree created) — read `recomputeReady` / `ALLOWED`; add tests, fix only if
  wrong.
- UI: global cap in settings, priority field in the Job/plan edit UI (small additive change in
  `JobsView.tsx` or `NewRunModal.tsx`).
- Tests: global cap across 3 Jobs, priority ordering, fairness, paused isolation, failed/cancelled deps
  never release dependents, no double-dispatch of the same Task.

Note: W1-C adds `Job.archivedAt` in parallel. Treat a Job with `archivedAt` as inactive via a tiny helper
you both may define — if absent when you merge, the MERGE step reconciles it.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full `npm test` run with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
