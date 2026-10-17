You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, docs/orchestrator/LINUX.md, and the SPEC.md sections named below. Then inspect
the existing code named here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w3-activity`, branch `feat/orch-activity-feed`.

SPEC sections: §9.

# W3-A — Unified activity feed, summaries, throttled notifications

Build:
- `src/core/orchestration/activity.ts`: append-only event log derived from orchestration state
  transitions (task status changes, dispatch start/exit, gate open/resolve, roll events, PR/issue link
  changes) with project/plan/task/session/model/account on each event. Persist bounded (reuse store
  patterns / TTL), survive restart.
- Summaries: pure `summarize(events, since)` → completed / failed / cancelled / awaiting review /
  blocked-with-reasons (reuse `blocked.ts`). Powers "what finished in the last 15 minutes".
- Notifications: route important events (task failed, plan done, gate needs me, worker waiting for input)
  through existing `desktopNotifier` and Slack notifier; periodic digest at a configurable interval
  (settings); dedupe/rate-limit so no flooding.
- UI: `components/activity/` feed (global + per-plan filter) mounted in the plan workspace and a global
  view.
- Tests: event derivation, summarize windows, throttling, persistence.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
