You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/orchestrator/USAGE.md. Read docs/orchestrator/DESIGN.md and open its mockup. W9-A is merged; use only its tokens and primitives.
W9-B, W9-C and W9-E run in parallel; meet them only through `components/shell/navigation.ts`.

Worktree + branch: slug `w9-inbox`, branch `feat/ui-inbox-command`.

# W9-D — Inbox page and one search/command box

- **Inbox page** (`components/inbox/*`, DESIGN.md §2 "Inbox"), in two columns. Left, "Needs you": plan approvals, escalations, `astera ask` questions,
  permission waits, give-ups — each answered inline with W7-C's answer box, oldest first; then "Activity", the W3-A
  feed, titled "Handled for you". A permission wait only offers "Answer in its console" (`openConsole`). Fill
  `openInbox(filter?)`. Desktop notices, the chime's notice click and the rail badge all lead here.
- **One box:** merge the W3-B command bar and the W3-C session search into one overlay on one key (the command key;
  the search key becomes an alias). Typing searches sessions, plans and Tasks (initials too); a sentence runs as a
  command; results show "project › plan · task". Opening a plan goes through `openPlan`. Voice talk stays on its key.

## Done means
- Tests: inbox ordering and grouping, the merged box's mode choice (search vs command), filter routing. Dev-app
  screenshots. Typecheck, your tests, full suite via the flock line, results in the PR. Only your ownership row
  changed. PR into `main`. Do not merge.
