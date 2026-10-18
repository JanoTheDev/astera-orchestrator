You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table),
docs/orchestrator/DESIGN.md (approved) and docs/orchestrator/USAGE.md, and open the mockup linked at the top of
DESIGN.md. W9-A is merged; use only its tokens and primitives. The other 9.2 tabs run in parallel; meet them only
through `components/shell/navigation.ts` and the PLAN contracts.

Worktree + branch: slug `w9-wall`, branch `feat/ui-agents-wall`.

# W9-H — See every CLI tab at once, step into any without disturbing the coordinator

Owner's words (2026-10-18): "i want a way to see all cli tabs, this is the most important part, and interact with
them as needed without interrupting the main claude tab that is working on all of them". Build DESIGN.md §3a
exactly.

1. **The wall tab.** `wall` TabKind (`core/panes/tabId.ts`), one pinned tab, the default on launch and on project
   switch. Scope (plan / project / all) and filter (all / needs you / running / finished); order needs-you →
   running → idle. Reuse `useWorkspaceData`, `useAttention` and W6-E `lastAction` for state; don't re-derive.
2. **Tiles are the real terminals.** Each tile mounts the session's existing xterm in tile mode: 11px font, fit to the
   tile, read-only until focused, rendering paused offscreen (IntersectionObserver). Never spawn or re-attach a
   process for a tile; switching never restarts anything (USAGE "The workspace").
   **Measure** on this laptop with 10–12 live tiles (CONTEXT rule 7: app alone, nothing heavy): CPU idle and while
   workers print. Over budget (DESIGN.md §3a) → text-tail fallback for unfocused tiles. Put the numbers in the PR.
3. **Interact.** "Send a line" uses the existing send path. Take over focuses the tile's xterm (keys go to that PTY
   only), shows the banner, Esc/Hand back releases, "Open as tab" moves it to a full tab. Fill
   `focusTile(sessionId)`.
4. **Owner hold.** `core/sessions/ownerHold.ts`: held from the owner's first keystroke in a session (the Host already
   sees owner input on `src/host/sessions.ts`; stamp it) or Take over, until Hand back or 60 s without owner input.
   `sessions-send` into a held session queues in the Host and answers `{ queued: true, reason: 'owner-typing',
   target }` at once; release delivers in order. The permission-prompt security rule in `sessions-send` is
   unchanged. One line in `orchestration-guide.md`: a queued send is delivered later, do not retry or wait on it.
5. **Finished row** renders W9-I's `SummaryCard` for ended tabs in scope (until W9-I merges, a stub card marked
   `shortcut: replace with W9-I SummaryCard after merge`).

## Done means
- Tests: tile ordering and filters, `isHeld` timing, queue-then-deliver order and the immediate `queued` answer
  (Host test like `src/host/orch.test.ts`'s `sessions-send` cases), the wall as default tab, pinned/no-close.
- Dev-app check by hand: 6+ real sessions in a scratch repo, take over one while the coordinator sends to it; the
  message arrives after Hand back, nothing else stalls. Screenshots + CPU numbers in the PR. Clean up (CONTEXT rule 7).
- Typecheck, your tests, full suite via the flock line, results in the PR. USAGE.md "The workspace" updated. Only
  your ownership row changed. PR into `main`. Do not merge.
