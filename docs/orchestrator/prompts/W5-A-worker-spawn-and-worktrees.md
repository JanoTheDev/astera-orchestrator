You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, docs/orchestrator/LINUX.md, docs/orchestrator/USAGE.md and the SPEC.md sections named below.
Then read each GitHub issue named here (`gh issue view <n> -R JanoTheDev/astera-orchestrator`: it has the repro and a
fix idea) and inspect the existing code it names before writing anything. Extend existing code; do not build parallel
systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w5-spawn`, branch `fix/orch-worker-spawn`.

SPEC sections: §2, §3.

# W5-A — Workers can read their spec, see their deps, and merge without a global git identity

Fix:
- **#52** Every worker stops at a permission prompt to read its own spec. The spec is written to
  `<profile>/orch/specs/` (`exec/specFiles.ts`), outside the worktree. Give worker and coordinator spawns read
  access to that directory (`exec/workerStart.ts`, `exec/coordinator.ts`; see how `previewShotsDir` reaches the spawn
  in `src/host/spawner.ts`). Grant only the specs directory, not the whole profile (it holds tokens).
- **#50** A dependent Task starts without its dependencies' commits. `forkWorktree` (`exec/integrateGit.ts`, called
  from `exec/dispatchLoop.ts`) forks from the project's checked-out branch; deps are merged only into the Run
  worktree. Fork a Task that has deps from the Run's branch after `integrate` has merged its finished deps.
  Test: A ∥ B → C in a temp repo, C's worktree contains A's and B's commits.
- **#51** The integration merge fails with "Committer identity unknown" when git has no global identity. Smallest fix
  that holds: check `git config user.name` / `user.email` in the project when a plan is approved and refuse with a
  clear message (shown by `approvePlan`'s `problems`), or give the merge an explicit identity. Pick one, say why
  in the PR. Never write the user's global git config.

Ownership: `exec/workerStart.ts`, `exec/coordinator.ts`, `exec/specFiles.ts`, `exec/integrateGit.ts`, the fork call
in `exec/dispatchLoop.ts`. Additive: `src/host/spawner.ts`, `runChecks.ts` (approval check).

## Done means
- Every issue above fixed and covered by a regression test that fails without the fix (or, where the issue says so,
  the limitation explained in the PR with the smallest extension).
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator; its body says `Fixes #<n>` for each issue.
  Do not merge.
