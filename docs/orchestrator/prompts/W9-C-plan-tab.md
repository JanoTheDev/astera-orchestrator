You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/orchestrator/USAGE.md. Read docs/orchestrator/DESIGN.md and open its mockup. W9-A is merged; use only its tokens and primitives.
W9-B, W9-D and W9-E run in parallel; meet them only through `components/shell/navigation.ts`.

Worktree + branch: slug `w9-plan-tab`, branch `feat/ui-plan-tab`.

# W9-C — A plan is a tab

- Add `plan` to `TabKind` and `planTab(jobId)` in `core/panes/tabId.ts` (tests beside the existing ones).
  `PaneGrid` renders it through `renderPlan`. Saved layouts with a plan tab whose Job is gone drop it on load.
- `components/plan/PlanTab.tsx` with sections Overview, Board, Files, Changes, Journal, holding everything
  `RunDetail.tsx` holds today: objective/source, delivery, usage strip, approve and W7-A talk, gates, completion
  checks, board/graph, files, diffs and PR, W8 attribution, journal, new task. Move code, don't rewrite it; the
  pinned RunDetail tests move with it. Then delete `RunDetail.tsx` and its modal.
- Fill `openPlan(jobId)`: open or focus the Plan tab and scope the grid to that plan (W6-F's plan scope).
- `JobsView.tsx`: its list is now the Plans section (W9-B mounts it); keep its actions (rename, archive, hold,
  priority) in a row `Menu`.

## Done means
- Every RunDetail control reachable in the Plan tab (list them in the PR, before → after). Tests for the tab kind,
  the stale-tab drop and `openPlan`'s focus-or-open rule. Dev-app screenshots of each section.
- Typecheck, your tests, full suite via the flock line, results in the PR. Only your ownership row changed. PR into
  `main`. Do not merge.
