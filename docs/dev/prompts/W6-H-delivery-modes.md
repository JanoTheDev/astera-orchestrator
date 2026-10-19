You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md (especially "Wave 6 — Autopilot" and its contracts), docs/guide.md
and the SPEC.md sections named below. Inspect the existing code named here before writing anything. Extend
existing code; do not build parallel systems. Use the Wave 6 contract names exactly as PLAN.md spells them. This prompt was added while the other W6 tabs
were running: read PLAN.md and this file from the main checkout (/home/jonx/Desktop/Astera), not your worktree's
older copy.

Worktree + branch (rule 1 in CONTEXT.md): slug `w6-delivery`, branch `feat/orch-delivery-modes`.

SPEC sections: §7.

# W6-H — How a finished plan lands: push to main, or a PR

The owner works differently per project. gameful is unreleased: fix in worktrees, then land straight on `main` and
push. Later, and on other projects, it is one PR per plan. Today both exist only as manual steps: `run-merge`
merges a Run's worktrees into the project folder, and `run-open-pr` opens the PR. Nothing picks one when a plan
finishes.

Read first: the `run-merge`, `run-open-pr` and `run-delete` cases in `command.ts`, `exec/integrateGit.ts`
(merge, identity fallback, dirty and unchecked worktrees), `Project` in `types.ts`, `core/github/prCreate.ts`, and
how a Run reaches "completed".

1. **Setting.** `Project.delivery?: 'pr' | 'push'`. Missing means `'pr'`, today's owner decision, so nothing
   changes for a project nobody set. A Job may override it (`jobs-create --delivery`, `jobs-plan --delivery`). Add a
   per-project selector in the project settings UI and a `projects-set --delivery` command. The label says plainly:
   "Push to <branch> when the plan is done (no review by a person)".
2. **When.** A Run's last Task passes review **and** W6-D's final check declares it done. Then Astera delivers on
   its own, as the last step:
   - `pr`: the existing `run-open-pr` path. Never merged by Astera.
   - `push`: the steps in item 3.
3. **Push, safely.** This is outward-facing and lands without human review, so every guard below is required:
   1. Target branch: the repo's default branch (`main`), or `Project.deliveryBranch` when set.
   2. The project folder must be on that branch with no uncommitted changes. Otherwise stop and escalate
      (`task.escalated`, W6-B) with "your folder has changes / is on branch X". Never stash or reset the owner's
      work.
   3. `git fetch`, then fast-forward the local branch (`merge --ff-only`). If it cannot fast-forward, escalate.
   4. Merge the Run's worktrees with the existing `mergeWorktrees`. On conflict, escalate and leave everything as
      it is.
   5. Run the project's validation command once more on the merged tree (`exec/validator.ts`). On failure, undo
      **only Astera's own merge commits** (reset to the commit recorded before step 4; the folder was clean, so
      nothing of the owner's is lost), then escalate.
   6. `git push origin <branch>`. **Never** `--force` or `--force-with-lease`. A rejected push: fetch, one
      fast-forward retry, then escalate.
   7. Commit messages carry `Fixes #<n>` for every issue the plan came from, so GitHub closes them on push.
   8. Record the result on the Run: pushed SHA, or the escalation reason. Emit `plan.delivered` (feed + notice,
      no chime).
4. **Worktrees.** After a successful push, remove the Run's merged worktrees and branches, the same way
   `run-delete`'s checkbox does. Keep them on any failure.
5. Tests: each guard in item 3 gets a test with a fake git runner (dirty folder, wrong branch, ff fails, conflict,
   validation fails and rolls back only Astera's commits, push rejected, never `--force` in any argv).

Ownership: see the W6-H row of PLAN.md.

## Done means
- Every item above works and is covered by a test that fails without it.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
