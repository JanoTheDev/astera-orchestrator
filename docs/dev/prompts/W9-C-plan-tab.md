You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/guide.md. Read docs/dev/DESIGN.md and open its mockup. W9-A is merged; use only its tokens and primitives.
W9-B, W9-D and W9-E run in parallel; meet them only through `components/shell/navigation.ts`.

Worktree + branch: slug `w9-plan-tab`, branch `feat/ui-plan-tab`.

# W9-C — Tasks page, Plans page, plan page

Build DESIGN.md §2 "Tasks" and "Plans" exactly.
- **Tasks page** (`components/pages/TasksPage.tsx`): every Task of the project across plans, in five columns
  (Planned · Working · Needs you · In review · Done), with plan filter pills.
  - Cards come from `JobTask`, `taskBoardsOf` (why it waits) and W6-E `lastAction`.
  - Click rules: working or in review → `openConsole`; needs you → `openInbox`; planned → `openPlan(job, 'waves')`;
    done → its summary (W9-I).
- **Plans page:** two views. "By area" groups plans by W8-D `Job.areas`, with an "overlaps <plan>" chip; "Overlap" is
  the plans × folders table from `Job.overlaps` and `affectedPaths`. The rows come from `JobsView` (state, source, progress bar, delivery, age; queued plans with "starts
  after X", W8-C), and the plan page with Overview, Waves, Files, Changes and Journal.
  - Move `RunDetail.tsx`'s content in; do not rewrite it. The pinned RunDetail tests move with it.
  - Then delete `RunDetail.tsx` and its modal.
  - "What happened so far" in Overview rolls up W9-I summaries (until W9-I merges:
    `shortcut: wire W9-I roll-up after merge`).
- Fill `openPlan(jobId, section?)`. Keep `JobsView`'s actions (rename, archive, hold, priority, workers, start after)
  in the plan page's ⋯ menu.

## Done means
- Every RunDetail control reachable on the plan page (list them in the PR, before → after). Tests: Tasks column
  assignment, the click rules, plan list ordering, and `openPlan` sections. Dev-app screenshots of each page.
- Typecheck, your tests, full suite via the flock line, results in the PR. Only your ownership row changed. PR into
  `main`. Do not merge.
