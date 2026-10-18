You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/orchestrator/USAGE.md. Read docs/orchestrator/DESIGN.md and open its mockup. W9-A is merged; use only its tokens and primitives.
W9-B, W9-C and W9-D run in parallel; meet them only through `components/shell/navigation.ts`.

Worktree + branch: slug `w9-settings`, branch `feat/ui-settings-dialogs`.

# W9-E — Settings page in 7 groups, every dialog on one Modal, one New flow

- **Settings page** (not a modal): `components/settings/` with one file per group (General, Accounts & usage, Agents, Projects,
  Integrations, Notifications, Advanced) per DESIGN.md's settings table. Move the inline JSX out of `App.tsx`
  (worktree, info and others). A search field filters settings by label. Fill `openSettings(group, anchor?)`. The
  Projects group lists projects and opens W7-B's per-project page.
- **Dialogs:** every dialog in DESIGN.md "Dialogs" uses `ui/Modal`; delete the hand-rolled backdrops.
- **One New flow:** "New" (top bar, `Ctrl+N`) picks console / plan from a goal / plan from a source (incl. W8-C prompt files and "Start after"), then shows the existing
  form (`NewSessionDialog`, `NewPlanDialog`, `SourceJobModal` content) in the same Modal. Keep each form's logic
  and tests; only the frame and the entry change.

## Done means
- Every existing setting reachable (PR table: old tab → new group), every dialog on `Modal`. Tests for the settings
  filter and the New flow's step choice. Dev-app screenshots. Typecheck, your tests, full suite via the flock line,
  results in the PR. Only your ownership row changed. PR into `main`. Do not merge.
