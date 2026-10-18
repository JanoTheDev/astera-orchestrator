You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table),
docs/orchestrator/DESIGN.md (approved) and docs/orchestrator/USAGE.md, and open the mockup linked at the top of
DESIGN.md. W9-A is merged; use only its tokens and primitives. The other 9.2 tabs run in parallel; meet them only
through `components/shell/navigation.ts` and the PLAN contracts.

Worktree + branch: slug `w9-wall`, branch `feat/ui-agents-wall`.

# W9-H — Agents page: every console at once, the main console, details, step in without disturbing

Owner's words (2026-10-18): "i want a way to see all cli tabs, this is the most important part, and interact with
them as needed without interrupting the main claude tab that is working on all of them". Build DESIGN.md §3a
exactly.

1. **Agents page** (`components/pages/AgentsPage.tsx`):
   - The console strip.
   - The **plan filter** pills (All plans / each plan with progress / No plan) that filter the tiles and the strip
     (DESIGN.md §2). Each plan's coordinator is pinned first; filtered to one plan, it is the double-height main tile.
   - The wall: the coordinator pinned as the double-height "main" tile, then tiles ordered needs-you, working, idle,
     with scope and filter.
   - The Finished row.
   - Reuse `useAttention`, `lastAction`, `taskBoardsOf` and `JobTask` for every state and count; don't re-derive.
2. **Tiles are the real terminals.** Each tile mounts the session's existing xterm in tile mode: 10.5–11px font,
   read-only until opened, rendering paused offscreen (IntersectionObserver). Never spawn or re-attach a process
   for a tile. **Measure** with 10–12 live tiles (CONTEXT rule 7: app alone): CPU idle and while workers print.
   Over budget (DESIGN.md §2) → text-tail fallback. Put the numbers in the PR.
3. **Full-size console:**
   - The slim header, then the xterm with keyboard focus. Keys go to that PTY only.
   - **No Astera input box or chat UI** (DESIGN.md §0).
   - The details panel on the right, per role (DESIGN.md §2), built from Host data only.
   - Fill `openConsole(sessionId)`.
   - Stop offering the assistant-ui conversation pane for new consoles. Existing ones still open.
4. **Owner hold.** `core/sessions/ownerHold.ts`:
   - Held while the console is open full size, or for 60 s after the owner's last keystroke in it. Stamp owner input
     on `src/host/sessions.ts`.
   - `sessions-send` into a held session queues in the Host and answers `{ queued: true, reason: 'owner-typing',
     target }` at once. On release, the Host delivers the queue in order.
   - The permission-prompt security rule in `sessions-send` is unchanged.
   - Add one line to `orchestration-guide.md`: a queued send is delivered later; do not retry or wait on it.
5. **Finished row** renders W9-I's `SummaryCard` (until W9-I merges, a stub card marked
   `shortcut: replace with W9-I SummaryCard after merge`).

## Done means
- Tests: tile ordering and filters, progress counts, details-panel data per role, `isHeld` timing, queue-then-deliver
  order and the immediate `queued` answer (Host test like `src/host/orch.test.ts`'s `sessions-send` cases), Agents as
  the default page.
- Dev-app check by hand: 6+ real sessions in a scratch repo, open one full size while the coordinator sends to it; the
  message arrives after "Back to all", nothing else stalls. Screenshots + CPU numbers in the PR. Clean up (CONTEXT rule 7).
- Typecheck, your tests, full suite via the flock line, results in the PR. USAGE.md "The workspace" updated. Only
  your ownership row changed. PR into `main`. Do not merge.
