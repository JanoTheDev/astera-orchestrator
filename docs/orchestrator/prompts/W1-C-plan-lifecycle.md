You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, and the SPEC.md sections named below. Then inspect the existing code named
here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w1-lifecycle`, branch `feat/orch-plan-lifecycle`.

SPEC sections: §5, §12 (lifecycle).

# W1-C — Plan lifecycle: name, rename, archive, pause/resume

Today a Job has `objective` but no display title; no archive; `paused`/`pendingStart` exist.

Build:
- `Job.title?: string` (fallback: first line of objective, as the UI does now — find that logic in
  `JobsView.tsx` / `JobsView.title.test.ts` and reuse it).
- `Job.archivedAt?: string`. Archiving hides the plan from default lists, stops *new* dispatches for it,
  and does **not** kill running sessions unless an explicit `killSessions: true` option (UI must confirm).
  Unarchive restores it. Export one helper `isJobActive(job)` in new
  `src/core/orchestration/lifecycle.ts`.
- Commands (follow existing patterns in `command.ts`, also exposed via MCP automatically if that's how
  others are): `jobs-rename`, `jobs-archive [--kill-sessions]`, `jobs-unarchive`. Reuse existing
  pause/resume commands — verify they exist and cover both `Job.paused` and `JobRun.paused`.
- `store.ts`: make sure the 30-day TTL never deletes an archived *Job* definition (only finished Runs, as
  today) and that loading old files without these fields works (migration-free).
- UI (`JobsView.tsx`): rename inline, archive/unarchive, "show archived" toggle.
- Tests: rename, archive keeps sessions alive, archive blocks new dispatch, archive+kill closes sessions,
  persistence round-trip, old-file load.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full `npm test` run with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
