You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, docs/orchestrator/LINUX.md, and the SPEC.md sections named below. Then inspect
the existing code named here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w2-github`, branch `feat/orch-github-links`.

SPEC sections: §7.

# W2-D — GitHub: task ↔ issue / branch / commits / PR

Inspect first: `src/core/github/*` (gh wrapper, prs, prCreate, issueSource), `src/main/githubPrs.ts`,
`CreatePrDialog.tsx`, `PrBadge.tsx`, and how Task worktree branches are named (`exec/integrateGit.ts`).
The owner's repos have CLAUDE.md rules that create Issues and add them to GitHub Projects — that workflow
stays in charge of creating issues.

Build:
- `Task.links?: { issue?: {number, url}, branch?, prs?: {number, url, state}[], commits?: string[] }`
  (append).
- `src/core/github/taskLinks.ts`: find-existing-issue lookup (by title / label / body marker via `gh
  issue list --search`) to avoid duplicates; link only, never create, unless the repo has no CLAUDE.md
  issue workflow and the user explicitly asks (command flag).
- Branch + commits from the Task's worktree/git range (already recorded: `GitRange`); PR via existing PR
  polling.
- Command `task-link-issue` (+ automatic linking when a worker reports `worker_done` with an issue
  number). Worker spec tells workers to follow the repo's CLAUDE.md for issue handling and to report the
  issue number.
- **One PR per plan (owner decision).** When a Run completes (all tasks done + checks), push the Run's
  integration branch and open a single PR to the project's default branch via the existing
  `prCreate.ts`, body listing every task, its acceptance criteria, linked issues ("Closes #n" only for
  issues the repo workflow created for this plan) and the model/account that did it. Never auto-merge.
  Replaces the local Merge click as the default for orchestrated plans; keep the local button available.
- Status polling reuses existing PR polling cadence; no new poller if one exists.
- Tests with a stubbed `gh`: dedup finds existing issue, no creation by default, link persistence.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full `npm test` run with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
