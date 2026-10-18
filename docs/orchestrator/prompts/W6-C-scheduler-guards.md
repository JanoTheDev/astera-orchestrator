You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md (especially "Wave 6 — Autopilot" and its contracts), docs/orchestrator/USAGE.md
and the SPEC.md sections named below. Inspect the existing code named here before writing anything. Extend
existing code; do not build parallel systems. Use the Wave 6 contract names exactly as PLAN.md spells them.

Worktree + branch (rule 1 in CONTEXT.md): slug `w6-guards`, branch `feat/orch-scheduler-guards`.

SPEC sections: §2, §3.

# W6-C — Never two tabs on the same files, 10 tabs max, review until right

Read first: `schedule.ts` (`slotsToFill`), `blocked.ts` (the "why is it waiting" reasons), `planner.ts:150-160`
(`affectedPaths` is only prompt text today), `settings/maxConcurrentWorkers.ts`, `convergence.ts`,
`exec/reviewGate.ts`, `MAX_REVIEW_ROUNDS` in `types.ts`.

1. **File overlap guard.** In `slotsToFill`, skip a ready Task whose `affectedPaths` overlap the `affectedPaths` of
   any Task currently dispatched (running, validating, reviewing, repairing) in the same Job. Two paths overlap when
   they are equal, or one is a directory prefix of the other (`src/a` vs `src/a/b.ts`; not `src/ab`). Globs: treat
   the part before the first `*` as a directory prefix. A Task with no `affectedPaths` overlaps nothing (keep today's
   behaviour). Pure function `pathsOverlap(a, b)` with tests for each case.
2. **Reason.** `blocked.ts` gets a reason "waiting for <task title>, which edits the same files (<first path>)".
3. **Hard cap 10.** The app-wide `maxConcurrentWorkers` never exceeds 10: a missing or larger value reads as 10.
   Today no cap means unlimited, so this is a deliberate behaviour change; say so in the PR. The per-Job
   `concurrency` default stays 3, but the planner may set it up to 10. Check that `jobs-plan` / `task-create` allow
   that, and clamp it.
4. **Review rounds.** `MAX_REVIEW_ROUNDS` goes from 2 to 5 (per-Job override kept). When the cap is hit, the Gate it
   opens carries `reason: 'review-rounds-exhausted'` so W6-B's escalation notice and sound pick it up. Do not change
   what a Gate does.

Ownership: see the W6-C row of PLAN.md.

## Done means
- Every item above works and is covered by a test that fails without it.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
