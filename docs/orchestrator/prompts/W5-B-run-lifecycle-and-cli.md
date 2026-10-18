You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, docs/orchestrator/LINUX.md, docs/orchestrator/USAGE.md and the SPEC.md sections named below.
Then read each GitHub issue named here (`gh issue view <n> -R JanoTheDev/astera-orchestrator`: it has the repro and a
fix idea) and inspect the existing code it names before writing anything. Extend existing code; do not build parallel
systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w5-lifecycle`, branch `fix/orch-run-lifecycle`.

SPEC sections: §2, §4, §12.

# W5-B — Stop/resume, archive, planner end, and the tasks CLI

Fix:
- **#45** A plan with no coordinator never continues after `runs-stop` → `runs-resume`: the loop skips Tasks whose
  last Dispatch has `closedBy: 'stop'` (`lostAttemptOf`). In `runs-resume`, put those Tasks back to `ready`
  (as the lost-worker Gate does). Test: stop and resume a coordinator-less plan, each Task is placed once, no
  duplicates. Also fix the board reason "its coordinator decides on a retry" for a plan that has no coordinator
  (`blocked.ts`).
- **#46** `jobs archive --kill-sessions` leaves the planner (`Job.plannerSessionIds`) and workers whose Dispatch
  already reported. End every session of the plan, open or reported, plus the planners. Without `--kill-sessions`
  nothing is killed (SPEC §12, CONTEXT rule 6).
- **#47** The planner session never ends and gets "Continue the work" after a usage-limit reset. End
  `plannerSessionIds` when the plan is approved (`run-start`), and keep them out of the limit-resume path.
- **#49** `tasks list --run <jobId>` says "unknown run" before the first Run, while `task-create` accepts the Job id.
  Accept a Job id there the same way (`state.ts`), or add `--job`; update `cliUsage.ts`.
- **#53** `tasks add` has no `--difficulty` / `--model`. Add both (`cliArgs.ts`, `cliUsage.ts`), validated, mapping to
  `Task.difficulty` / `Task.model` that `resolveWorkerModel` already reads.

Ownership: `command.ts` handlers for `runs-resume`, `jobs-archive`, `run-start` (planner end), `tasks-list`;
`lifecycle.ts`, `state.ts` run lookup, `cliArgs.ts`, `cliUsage.ts`, `blocked.ts` reason text. Additive: `planner.ts`,
`exec/dispatchLoop.ts` (only if the resume fix needs it; W5-A owns its fork call), `exec/limitProbe.ts`.

## Done means
- Every issue above fixed and covered by a regression test that fails without the fix (or, where the issue says so,
  the limitation explained in the PR with the smallest extension).
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator; its body says `Fixes #<n>` for each issue.
  Do not merge.
