You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/orchestrator/USAGE.md. Read docs/orchestrator/DESIGN.md and open its mockup. W9-A is merged; use only its tokens and primitives.
W9-C, W9-D and W9-E run in parallel; meet them only through `components/shell/navigation.ts`.

Worktree + branch: slug `w9-shell`, branch `feat/ui-shell-nav`.

# W9-B — Titlebar, rail, Home sidebar, status bar

- **Titlebar:** project switcher (W6-F `ProjectSwitcher`) on the left; the search/command box in the centre is a
  button that opens W9-D's bar (call it through a prop; W9-D owns the bar); run config and one `Meter` on the right.
- **Rail:** Home, Inbox (badge from `useAttention`), Files, How It Works, Settings. The Jobs entry is gone; its
  key binding opens Home's Plans section.
- **Home sidebar:** `Section`s Plans (the W2-B/W6-F tree, plan rows with progress and waiting dot, "+ New"),
  Sessions, Worktrees, History. Accounts leave the stack.
- **Status bar:** running and waiting counts (waiting → `openInbox()`), active account + `Meter` → accounts
  popover (the W7-F sign-in/remove rows), branch, host health. Remove the other three usage renderings; every usage
  display is `ui/Meter`.
- Plan rows and notices call `openPlan(jobId)`; never open `RunDetail` directly.

## Done means
- Tests for logic you add (section defaults, old rail id mapping, waiting count). UI checked by hand in the dev app
  (alone, CONTEXT rule 7), screenshots in the PR next to the mockup's frames.
- Typecheck clean, your tests pass, full suite via the flock line, results in the PR. Only your ownership row of
  PLAN.md changed. PR into `main`. Do not merge.
