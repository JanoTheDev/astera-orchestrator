Run in ONE Claude tab after every tab in a wave has opened its PR.

You are in /home/jonx/Desktop/Astera (my private fork, repo JanoTheDev/astera-orchestrator). Read
docs/orchestrator/CONTEXT.md and PLAN.md first.

1. `gh pr list --state open` — these are this wave's PRs. Read each PR description.
2. Merge them one by one into `main` (merge commits, not squash), in an order that minimises conflicts
   (core before UI). For conflicts: they should be small additive hunks in shared files (`types.ts`,
   `command.ts`, settings types, `App.tsx`) — keep both sides. Reconcile any helper the PLAN says two PRs
   both define (e.g. `isJobActive`) into one.
3. After each merge: `npm ci` if the lockfile changed, `npm run typecheck`, `npm test`. Stop and report if
   a merge breaks tests that passed on its branch — fix only integration breakage, explain each fix.
4. Push `main`. Remove merged worktrees: `git worktree remove ../astera-wt/<slug>` and delete merged
   branches locally and on origin.
5. Report: merged PRs, conflicts resolved, final test summary, anything the next wave must know.
