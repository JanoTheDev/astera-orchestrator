You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, docs/orchestrator/LINUX.md, and the SPEC.md sections named below. Then inspect
the existing code named here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w3-tests`, branch `test/orch-routing-recovery`.

SPEC sections: §3, §6, §10, §12.

# W3-D — Routing, recovery and concurrency test hardening

You mostly write tests. When a test exposes a real bug, fix it minimally and describe each fix.

Cover (use existing test helpers/fakes in `src/core/orchestration/**/*.test.ts`, `src/host/*.test.ts`):
- Session routing: instruction for plan A worker 2 reaches exactly that session id; never another plan's.
- Restart recovery: persisted state with running dispatches → recovery reattaches / marks lost without
  launching duplicate workers (`src/host/recovery.ts`, `resumeSweep.ts`, `lostGate.ts`).
- Global cap + per-plan cap under churn (W1-B), pause isolation, archive isolation (W1-C).
- Failure / retry / circuit-break / cancel: dependents never launch; cancelled vs failed vs
  awaiting-review distinct.
- Planner cannot dispatch (W2-A): already covered by `planner.test.ts` and `src/host/orchPlanner.test.ts`. Read
  them and add only what is missing (e.g. the planner stays gated after approval, a second `jobs plan` on the
  same Job, an agent session approving through `jobs run`). Don't duplicate.
- A Linux e2e smoke if feasible with existing e2e setup (`*.linux.e2e.test.ts`): spawn Host, create
  plan with 3 tasks (A, B parallel; C depends on both) using a fake CLI script instead of real claude,
  assert ordering and completion.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
