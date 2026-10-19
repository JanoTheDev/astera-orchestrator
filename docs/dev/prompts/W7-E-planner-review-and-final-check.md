You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md ("Wave 6 — Autopilot" and its contracts, "Wave 7"), docs/dev/LINUX.md (section
"Autopilot dogfood (W6-V)") and docs/guide.md. Then read each GitHub issue named here
(`gh issue view <n> -R JanoTheDev/astera-orchestrator`: it has the repro, what the dogfood saw and a file guess) and
inspect the existing code it names before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w7-review`, branch `fix/orch-review-final-check`.

SPEC sections: §4, §8.

# W7-E — Every planned Task is reviewed, every plan gets exactly one final check

The W6-V dogfood ran four planned plans. No Task was reviewed, one plan ran its final check twice, another skipped
it, and fixlist and audit planners never wrote `existing.md`.

Fix:
- **#70** No reviewer checks finished Tasks of a planned plan (Tasks go validating → completed in about 1 s). Wave 6
  promised a fresh reviewer per Task with up to 5 rounds (W6-C's `MAX_REVIEW_ROUNDS`), then an escalation. Make a
  planned Job's Tasks reviewed by default: the planner brief tells it to pass `--review`, or (preferred, so a planner
  cannot forget) the Job carries a review default that `jobs-plan` sets and the dispatch path honours. A Job made
  with `--no-review` (new) skips it. Reuse `reviewer.ts`, `exec/reviewGate.ts`, `convergence.ts`; do not add a second
  review path. The board's "Awaiting review" count must move.
- **#74** One plan ran the completion pass twice (plan.replanned + plan.done at 10:11:55 and again at 10:21:40);
  the issue plan, whose Tasks the Host placed with no coordinator, skipped it. Exactly one completion pass per
  planned plan, on both paths (`replan.ts` trigger and its once-guard, `exec/dispatchLoop.ts`, recovery).
- **#69** Fixlist and audit planners never write `inputs/existing.md`: `buildPlannerBrief` says "Do not edit, create
  or delete files" (`handover.ts`) while `planner-guide.md` says to write it. Allow writes to the Job's own
  `inputs/` folder only, say so in the brief, and keep every other file read-only. The audit planner must write both
  `audit.md` and `existing.md`.
- **#80** A project with no remote reports "The push was rejected" at the PR step. Say "This project has no remote;
  the plan's work is on branch <name>" and do not count it as a failure.

Ownership: `handover.ts` (planner brief), `resources/skills/planner-guide.md`, `core/orchestration/replan.ts`,
`exec/replanStart.ts`, `reviewer.ts`, `exec/reviewGate.ts`. Additive: `exec/plannerStart.ts`, `exec/dispatchLoop.ts`,
`types.ts` (`Job.review` or similar), `command.ts` (`jobs-plan` / `jobs-create` flag), `src/core/github/*` (no-remote
message).

## Done means
- Every issue above fixed and covered by a regression test that fails without the fix.
- By hand in the dev app: one two-Task fixlist plan in a scratch repo shows each Task "Awaiting review" before done,
  writes `inputs/existing.md`, and has exactly one `plan.replanning` (completion) line in the feed.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator; its body says `Fixes #<n>` for each issue.
  Do not merge.
