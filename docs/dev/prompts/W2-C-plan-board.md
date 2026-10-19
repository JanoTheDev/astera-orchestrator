You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md, docs/dev/LINUX.md, and the SPEC.md sections named below. Then inspect
the existing code named here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w2-board`, branch `feat/orch-plan-board`.

SPEC sections: §3, §9 (blocked reasons), §12 (plan workspace contents).

# W2-C — Plan overview + task board with "why is it waiting"

Today `RunDetail.tsx` + `graph.ts`/`graphLayout.ts` render a Run. Don't replace them.

Build:
- Pure `src/core/orchestration/blocked.ts`: for each non-running Task return a reason: waiting on deps
  (which), global cap / plan cap full (W1-B `maxConcurrentWorkers`, `Job.priority`), plan paused / archived /
  pendingStart (`jobActive`, `isJobActive`), no account, failure limit hit, gate open (which), awaiting
  review, rate-limited (roll state). Derived from existing state only; call the W1 helpers rather than
  re-deriving their rules (CONTEXT.md rule 9).
- New `src/renderer/src/components/plan/`: plan overview (progress %, counts of done / running / queued /
  failed / cancelled / awaiting-review clearly distinct), task board with per-task model + account +
  branch + attempts, reason badges from `blocked.ts`. Mount inside `RunDetail.tsx` (additive; you are its
  only editor this wave). Do NOT edit `App.tsx` (W2-B owns it this wave).
- Tests: each blocked reason, progress counting, status categorization.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
