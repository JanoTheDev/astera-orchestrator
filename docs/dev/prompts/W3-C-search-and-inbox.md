You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md, docs/dev/LINUX.md, and the SPEC.md sections named below. Then inspect
the existing code named here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w3-search`, branch `feat/orch-search-inbox`.

SPEC sections: §6, §12 (search), §8 ("show every session needing my input").

# W3-C — Cross-project session search + "needs my input" inbox

Build:
- `src/core/orchestration/sessionIndex.ts`: pure index of every session with project / plan / task /
  role / model / account / cwd / branch / attention state (idle / working / waiting from
  `src/core/sessions/attention.ts` + hook `sessionStateOf`) / open gates.
- Search UI in the workspace sidebar: fuzzy by project, plan, task title, session label; results keep
  context; selecting focuses the session in its plan workspace (reuse W2-B navigation).
- "Needs my input" list: sessions waiting on permission / question, open Gates, plans awaiting approval —
  across all projects; badge count in sidebar.
- Reuse W2 (CONTEXT rule 10): build on `workspaceTree.ts` / `useWorkspaceData` / `useAttention` and W2-B's plan
  navigation; the waiting reason per Task is `JobTask.board` (`taskBoardsOf`); planner sessions are
  `Job.plannerSessionIds`. "Plans awaiting approval" = `job.pendingStart && job.plannerSessionIds !== undefined`.
- W2-B's known gap: no read returns every project's Dispatches, so other projects' sessions refresh poorly. Add
  the read-only `dispatches-list [--run]` case in `command.ts` (same shape as `tasks-list`, with `cliUsage` /
  `docs/cli.md` entries; add it to `PLANNER_COMMANDS` only if a planner needs it) and switch `useWorkspaceData`
  to it.
- Tests: index building, search ranking basics, needs-input classification.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
