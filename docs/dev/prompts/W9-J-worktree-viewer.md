You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table),
docs/dev/DESIGN.md (approved) and docs/guide.md, and open the mockup linked at the top of
DESIGN.md. W9-A is merged; use only its tokens and primitives. The other 9.2 tabs run in parallel; meet them only
through `components/shell/navigation.ts` and the PLAN contracts.

Worktree + branch: slug `w9-worktrees`, branch `feat/ui-worktree-viewer`.

# W9-J — See every worktree, what is in it, and clean up in one click

Owner's words (2026-10-18): "would be nice to have a worktree viewer and stuff too to make it easier". Build
DESIGN.md "Worktrees" (§2) exactly.

Read first: `WorktreePanel.tsx`, `core/worktrees/{list,remove,registry,push,presence}.ts`, `PrBadge`/`PushBadge`,
`ChangedFilesBlock`/`DiffView`, `exec/integrateGit.ts` (which worktrees Astera creates per Task), W8 attribution
(`attribution-blame`), `core/orchestration/delivery.ts`.

1. **Worktrees page** (`components/pages/WorktreesPage.tsx`): `WorktreePanel` becomes the left list, grouped: per running plan, "Ready to clean
   up", "Yours". Rows: branch, ahead/behind, agent (Task, worker), dirty state. Reuse the existing list, refresh,
   PR/push badges and remove flow with its confirmations; don't rewrite them.
2. **Detail** (right side; `openWorktree(path)`): header with state, base, ahead/behind and actions (Its console →
   `openConsole`, Open session here → the existing start-session path, Open in Files, push / create PR / remove / copy
   path). Fact cards. Changes vs base (`DiffView` + W8-B gutter on click). Commits since base with W8 author.
3. **Clean up** (`core/worktrees/cleanup.ts`, pure rule + tested): ready = created by Astera for a Task that is
   merged, no live session, clean tree, nothing unpushed. "Clean up N" removes them through `remove.ts`.
   After a plan is delivered, its ready worktrees are removed automatically (setting `autoCleanWorktrees`, default
   true). Worktrees Astera did not create are **never** removed automatically. Never force-remove; anything the rule
   is unsure about stays in the list.
4. The console details panel and Task cards show the worktree branch as a link to `openWorktree` (one line each;
   coordinate in the PR with W9-H / W9-C).

## Done means
- Tests: the ready rule (merged+clean+no session → ready; dirty, unpushed, live session, not Astera's → not), the
  auto-clean call after delivery, grouping, and `openWorktree`.
- Dev-app check by hand in a scratch repo with two Task worktrees (one merged): list, tab, diff, clean up. Screenshots
  in the PR; clean up afterwards (CONTEXT rule 7).
- Typecheck, your tests, full suite via the flock line, results in the PR. USAGE.md gains "Worktrees". Only your
  ownership row changed. PR into `main`. Do not merge.
