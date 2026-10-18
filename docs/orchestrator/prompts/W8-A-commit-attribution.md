You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md (especially "Wave 8 — Who wrote this" and its contracts), docs/orchestrator/USAGE.md.
Inspect the existing code named here before writing anything. Extend existing code; do not build parallel
systems. Waves 6 and 7 are merged; build on them. Use the Wave 8 contract names exactly as PLAN.md spells them.

Worktree + branch (rule 1 in CONTEXT.md): slug `w8-commit-attribution`, branch `feat/orch-commit-attribution`.

# W8-A — Every AI commit says who made it, and keeps saying it after merges

Astera knows the author of every worker commit at spawn time: one worktree, one Task, one session, one model.
Today that knowledge is lost when the worktree goes away. Write it into git, so that it survives
Astera's merges, the owner's rebases, and GitHub squash.

Read first:
- `exec/workerStart.ts`: what a worker is spawned with (session, model, account, role)
- `exec/coordinator.ts`: the commit obligation
- `exec/integrateGit.ts`: merges, cherry-picks, and the fork base
- `core/orchestration/delivery.ts` (W6-H)
- `src/main/githubPrs.ts`
- `core/github/taskLinks.ts` (`taskMarker`)
- `core/workUnit/collector.ts`: the EG §26 windows
- the store that keeps dispatches and sessions (`sessionIndex.ts` and the Job store). Reuse it; add no new DB.

1. **Note format.** Add `core/attribution/note.ts`. It reads and writes the Wave 8 note JSON on
   `refs/notes/astera` through the existing git runner (`GitRun`). Use `git notes --ref astera add -f -F -` and
   `git notes --ref astera show`. Validate the JSON on read: a bad or foreign note counts as "unknown",
   and reading it never throws.
2. **Stamp.** Add `core/attribution/stamp.ts`. When a worker reports done, and before `integrateGit` merges, note
   every commit in `forkBase..taskBranch` with that worker's Job, Task, session, agent, model, account and role.
   - Do not rewrite or amend the worker's commits.
   - Commits that the owner made in that worktree get `human: true`. Use the session's EG §26 busy window
     against the commit time and author. When unsure, use unknown, never AI.
   - Store the Task-to-commit-shas map in the existing Job store.
3. **Carry through Astera's own git work.** In `integrateGit`:
   - Copy the notes when Astera cherry-picks. Git does not do this on its own.
   - Add the Wave 8 trailers to every merge commit Astera writes.
   - Set the three `notes.*` repo config keys once per project, idempotently.
4. **Delivery (W6-H).**
   - Push mode pushes `refs/notes/astera` next to the branch.
   - PR mode:
     1. Push the notes ref with the PR branch.
     2. Add an "AI attribution" block to the PR body: per Task, the agent/model, the commit count, and
        `ai_additions` / `human_additions`.
     3. Add the trailers, so that a GitHub squash body keeps them.
   - Project add (W7-B) adds the fetch refspec `+refs/notes/astera:refs/notes/astera`.
5. **Squash remap.** When the PR poll in `githubPrs.ts` sees an Astera PR merged by squash or by rebase, do this:
   1. Fetch.
   2. Find the new commit(s) on the base branch.
   3. Write notes on them from the stored map.
   4. For a squash commit, merge the per-commit `lines` by path. A line that came from mixed sources is
      marked mixed.
   - Do this once and idempotently.
   - Pushing the remapped notes is part of the same delivery, so no new prompt is needed.
6. **Blame / stats / why.** Add `core/attribution/blame.ts` and `stats.ts`, and add the commands
   `attribution-blame`, `attribution-stats`, `attribution-why` (CLI `astera blame|stats|why`).
   - Blame: `git blame --porcelain`, then each line's commit, then its note. Then use the note's `lines` if
     present. A commit with no note is human. A bad note is unknown.
   - Stats: use the contract field names, so they match git-ai's.
   - Why: print the Job, Task, session and role, plus the command that opens that session's transcript.
7. Tests:
   - Use real temp repos (`core/worktrees/testRepo.ts`).
   - Stamp on a two-commit worker branch: the notes are present, and the owner commit is `human: true`.
   - Notes survive `commit --amend` and `rebase` through the config. They survive Astera's cherry-pick through
     the copy.
   - Squash remap: simulate the squash with `git merge --squash` and a new commit. The notes land on it, and the
     stats are equal before and after.
   - A bad note gives unknown, not a crash.
   - Blame on a file with human and AI commits.
   - The stats JSON has the git-ai field names.
   - Delivery pushes the notes ref only in the modes above. Use the injected runner; there is no network.
   - Run full tests per CONTEXT.md rule 4 (`flock`, 2 workers).

Ownership: see the W8-A row of PLAN.md.
