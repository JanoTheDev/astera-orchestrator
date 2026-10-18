You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/orchestrator/USAGE.md. Read docs/orchestrator/DESIGN.md and open its mockup. W9-A is merged; use only its tokens and primitives.
W9-B, W9-C and W9-D run in parallel; meet them only through `components/shell/navigation.ts`.

Worktree + branch: slug `w9-settings`, branch `feat/ui-settings-dialogs`.

# W9-E — Start page, New, Settings page, every dialog on one Modal

- **Settings page** (not a modal): `components/settings/` with one file per group (General, Accounts & usage, Agents, Projects,
  Integrations, Notifications, Advanced) per DESIGN.md's settings table. Move the inline JSX out of `App.tsx`
  (worktree, info and others). A search field filters settings by label. Fill `openSettings(group, anchor?)`. The
  Projects group lists projects and opens W7-B's per-project page.
- **Dialogs:** every dialog in DESIGN.md "Dialogs" uses `ui/Modal`; delete the hand-rolled backdrops.
- **Start page** (`components/pages/StartPage.tsx`, DESIGN.md §2 "Start"):
  - Shown for a project with no plans or consoles, and from New and Plans → New plan.
  - The composer, with attachments (plus drop-anywhere on the window).
  - The two mode cards: "Plan it for me" → W6-A intake + W2-A planner; "Run as written" → W8-C `--mode prompts`.
  - The options row, with defaults from the project (W7-B), and a primary button whose label says what happens.
  - "Or pick up": assigned issues, unfixed audit findings, open a console.
  - Reuse `NewPlanDialog`, `SourceJobModal` and the intake logic and tests; only the frame changes.
- **New** (top bar, `Ctrl+N`) is a small `Modal` with Console / Plan it for me / Run as written. The plan choices
  go to Start. Console keeps `NewSessionDialog`'s form.

## Done means
- Every existing setting reachable (PR table: old tab → new group), every dialog on `Modal`. Tests for the settings
  filter, Start's mode default (files → Run as written, text → Plan it for me), drop-to-attach, and the empty-project
  landing. Dev-app screenshots. Typecheck, your tests, full suite via the flock line,
  results in the PR. Only your ownership row changed. PR into `main`. Do not merge.
