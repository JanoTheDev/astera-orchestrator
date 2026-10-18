You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 6 — Autopilot" and its contracts, "Wave 7"), docs/orchestrator/LINUX.md (section
"Autopilot dogfood (W6-V)") and docs/orchestrator/USAGE.md. Then read each GitHub issue named here
(`gh issue view <n> -R JanoTheDev/astera-orchestrator`: it has the repro, what the dogfood saw and a file guess) and
inspect the existing code it names before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w7-intake`, branch `fix/orch-intake-names`.

SPEC sections: §1, §3.

# W7-D — A plan made from a source has a real name, the worker count the owner picked, and safe CLI Tasks

Fix:
- **#68** Every plan made with the New plan dialog, a fixlist or a PDF is named "The source below is a list of
  problems…": sidebar, tabs, worktree branches, notices, search. Give each Job a `title` when it is created
  (`jobs-create`, `jobs-create-from-issue`, `intake.ts`): the first problem's words for a fixlist, the file names for
  attachments, "Audit <scope>" for an audit, the issue titles (all of them, e.g. "#1 unique() is O(n²) +1") for
  issues. `jobNameOf` then carries it everywhere. The PR title uses the same name. Never change a title the owner set.
- **#67** The New plan dialog has no worker count, and a plan's concurrency cannot change after planning starts. Add
  the field to `NewPlanDialog.tsx` (1–10, default from the project when W7-B's `projects-set` concurrency exists, else
  3) and send it as `concurrency` (`intakeRequest.ts`). Add one way to change a not-finished Job's concurrency: a
  `jobs-set --id --concurrency` command (reuse `concurrencyArg`) and the same control in the Run window header.
  Running workers are never stopped by a lower value; it only limits new starts.
- **#81** `tasks add` has no `--affected-paths`, so CLI Tasks escape W6-C's same-file guard. Add the flag (same
  shape and validation as the planner's), and make `--spec -` the documented way to pass a spec with quotes (the
  planner's first `tasks add` failed on JSON escaping).

Ownership: `core/orchestration/intake.ts`, `components/intake/*`, `command.ts` handlers `jobs-create` /
`jobs-create-from-issue` / new `jobs-set` / `tasks-add`, `cliArgs.ts`, `cliUsage.ts`, `cliAgentContext.ts` (flags).
Additive: `RunDetail.tsx` (header control), `lifecycle.ts` (`jobNameOf` only if needed), `src/core/github/*` (PR
title).

## Done means
- Every issue above fixed and covered by a regression test that fails without the fix.
- By hand in the dev app: two plans from the dialog read as two different names in the Jobs list, the sidebar and
  their tabs; one made with "Workers 10" shows "at most 10 at a time" in its planner's summary.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- USAGE.md "Starting from files…" lists the new field and `jobs-set`.
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator; its body says `Fixes #<n>` for each issue.
  Do not merge.
