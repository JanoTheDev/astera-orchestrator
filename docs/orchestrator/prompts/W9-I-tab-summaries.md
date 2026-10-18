You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table),
docs/orchestrator/DESIGN.md (approved) and docs/orchestrator/USAGE.md, and open the mockup linked at the top of
DESIGN.md. W9-A is merged; use only its tokens and primitives. The other 9.2 tabs run in parallel; meet them only
through `components/shell/navigation.ts` and the PLAN contracts.

Worktree + branch: slug `w9-summaries`, branch `feat/tab-summaries`.

# W9-I — Every tab leaves a short summary of what it did

Owner's words (2026-10-18): "each tab a small summary when done so i know what happened in each tab for later … very
hands off". Build DESIGN.md §3b exactly.

Read first: `core/workUnit/*` (`resultSummary`, `checks`), `core/understanding/*` (the How It Works generator: how
it calls a model and stores records), `src/host/hostUnderstanding.ts`, the session store in `src/host/sessions.ts`,
`activity.ts`, W8 `attribution-stats`, `core/orchestration/delivery.ts`.

1. **Facts** (`core/sessions/summary.ts`, pure, tested): from the session, its Dispatch/Task/Job, git diff or W8
   stats, work-unit checks, review rounds and verdict, questions and who answered (activity), commits/PR, outcome
   and duration.
2. **Prose:** 2–3 sentences by the coordinator role's model (`resolveRoleModel`), through the existing generator
   path, not a new agent runner. Input: facts, `resultSummary`, the last messages of the session. A failed or
   timed-out call stores the facts with no prose; never retry in a loop.
3. **Trigger** (`src/host/hostSummaries.ts`): on tab end (exit, Task merged/given up, W7-F auto-close) and for a plain
   session idle 10 min at a finished turn with writes. Once per session (idempotent). Runs on the Host, so it works
   with the window closed. Setting `tabSummaries` (default true) under Notifications.
4. **Store and read:** `SessionSummary` beside the session record; commands `sessions-summary <id>` and
   `summaries [--job <id>]` (add both to `PLANNER_COMMANDS` only if the planner needs them; it doesn't).
5. **Show:** `components/wall/SummaryCard.tsx` (used by W9-H's Finished row), one row on the board card and in
   History, the plan roll-up in Overview, and "What each task did" in the delivery PR body.

## Done means
- Tests: facts from fixtures (worker merged after 2 rounds, gave up, plain session), idempotent trigger, no-prose
  fallback, PR-body block. One real run in a scratch repo with one tiny Task: the card appears with prose; paste it.
- Typecheck, your tests, full suite via the flock line, results in the PR. USAGE.md gains "What each tab did". Only
  your ownership row changed. PR into `main`. Do not merge.
