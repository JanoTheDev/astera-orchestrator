You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/orchestrator/USAGE.md. Waves 1–8 are merged. Inspect the renderer (`src/renderer/src`) before designing; the survey in PLAN.md is
a starting point, not a substitute.

This prompt writes one doc and an artifact, no code. Branch `docs/w9-design` in a worktree
(`../astera-wt/w9-design`, no `npm ci`).

# W9-0 — Design spec and mockup (owner approves before any code)

Drafted ahead on 2026-10-18: `docs/orchestrator/DESIGN.md` and the mockup
(https://claude.ai/artifact/DhSiAPZxCigXD4xJBoFb9x) exist. If the owner has approved them (DESIGN.md "Status"),
only step 1 (before-screenshots) is left. Otherwise, take step 1, then continue the review loop (step 4) on the
existing files instead of starting over.

1. **Walk the app as it is.** Run it once (CONTEXT rule 7: fresh CDP port, alone, nothing else heavy running) and
   screenshot every surface: sidebar sections, Jobs, RunDetail, the board, inbox, command bar, every dialog, every
   Settings tab. Stop the app when done. These are the "before" pictures.
2. **Write `docs/orchestrator/DESIGN.md`:**
   - The layout from PLAN.md, made exact: every region, its contents, widths, what each rail view shows.
   - **Feature map:** a table listing every user-facing feature from Waves 1–8 (and the upstream ones kept:
     run configs, explorer, editor, browser pane, How It Works, remote runtimes, plugins, creative hub, Slack) with
     its one new home. No feature may be left without a row; none may have two homes.
   - Tokens: the full list with dark (`vega`, `umbra`, `aurora`) and `light` values. Contrast ratios for text
     on every surface (AA: 4.5 body, 3 large/UI).
   - Primitives: each one's variants, sizes, states (hover, focus, disabled, loading).
   - **Dialogs:** every existing dialog and what replaces it (`ui/Modal`, the New flow, a Settings group, or a tab).
   - **Pinned tests:** every source-regex/CSS test that reads renderer source (the survey lists them); for each,
     the invariant and which W9 prompt moves it.
   - Settings: every existing setting → its group.
   - Migration: saved `sidebarPane`, theme ids, `cm.*` localStorage keys → new values.
3. **Mockup:** a clickable HTML artifact (Artifact tool) with the shell, Home, a Plan tab (overview, board with
   waves and live cards, files, changes), the Inbox with a question answered inline, the New flow, Settings, and
   the status bar popover. A theme switcher shows all four themes. Use realistic data (a gameful plan, 3 waves,
   questions, an escalation). Link it at the top of DESIGN.md.
4. **Owner review loop:** give the owner the link. Apply their comments to the mockup and DESIGN.md until they say
   approved. Record the approval date and any decisions in PLAN.md "Wave 9 — Claude's calls".

## Done means
- DESIGN.md complete (feature map has no gaps), mockup approved by the owner, both linked from PLAN.md.
- PR into `main` with the before-screenshots attached. Do not merge.
