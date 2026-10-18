You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/orchestrator/USAGE.md. Read docs/orchestrator/DESIGN.md and open its mockup. W9-A is merged; use only its tokens and primitives.
W9-C, W9-D and W9-E run in parallel; meet them only through `components/shell/navigation.ts`.

Worktree + branch: slug `w9-shell`, branch `feat/ui-shell-nav`.

# W9-B — Top bar, pages shell, status bar

Build DESIGN.md §1 exactly. **The icon rail and the stacked sidebar go away.**
- **Top bar (44px):**
  - The mark and "Astera" `/` the project switcher (W6-F `ProjectSwitcher`, as a text button).
  - Page tabs Agents · Tasks · Plans · Inbox (count from `useAttention`) · Worktrees · Files · More ▾, as text with
    an accent underline.
  - The search field (it opens W9-D's box; call it through a prop), New (opens W9-E's New), the usage `Meter` (it
    opens the accounts popover with the W7-F sign-in/remove rows), and Settings ⚙.
  - Below 1024px the tabs collapse into "Pages ▾".
- **Pages shell:** `core/ui/pages.ts` holds the page ids and the saved-state mapping (DESIGN.md §13). Each page
  component is mounted by its owner prompt; you mount placeholders until they land. `Ctrl+1…6` switch pages.
- **More ▾:** History (`HistoryBrowser`, as a page), How It Works (`UnderstandingView` + record view), Browser, and
  Run configs (with the run output drawer).
- **Status bar:** consoles and working count (→ Agents), waiting count (→ `openInbox()`), "Next: X starts after Y
  delivers" (W8-C `Job.after`), the active account with 5-hour and weekly usage, and host health.
- **Usage:** every usage display is `ui/Meter`; delete the other three renderings.
- **Retire** `components/workspace/*` (the tree and sidebar) once nothing imports them. Move their tests' invariants
  to the pages that replace them, or delete a test only when its behaviour is gone, saying so in the PR.

## Done means
- Tests for logic you add (page id mapping from saved state, waiting count, next-queued line). UI checked by hand in the dev app
  (alone, CONTEXT rule 7), screenshots in the PR next to the mockup's frames.
- Typecheck clean, your tests pass, full suite via the flock line, results in the PR. Only your ownership row of
  PLAN.md changed. PR into `main`. Do not merge.
