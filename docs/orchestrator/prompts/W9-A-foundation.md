You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/orchestrator/USAGE.md. Read docs/orchestrator/DESIGN.md (approved in W9-0) in full and open its mockup.
**Run alone** — no other Wave 9 tab runs while this one does.

Worktree + branch (rule 1 in CONTEXT.md): slug `w9-foundation`, branch `refactor/ui-foundation`.

# W9-A — Tokens, primitives, shell split (no visible behaviour change except theming)

1. **Tokens and themes.** `styles/tokens.css` per DESIGN.md. `core/theme/themes.ts` keeps `vega`, `umbra`,
   `aurora`, adds `light` and `system`; removed ids map to `vega` on load (test it). `lib/theme.tsx` sets
   `data-theme` and `color-scheme`; `tailwind.css` stops forcing `dark`. Extend `contrast.test.ts` to every
   theme.
2. **Split `styles.css`** into `styles/{tokens,base,primitives}.css` plus feature files next to their components.
   Replace every colour literal with a token. Add a test: no hex/`rgb(` outside `tokens.css` in renderer CSS (the
   assistant-ui vendor dir excepted). Keep every selector name the pinned tests read, or update the test's path in
   the same commit with the invariant unchanged.
3. **Primitives** in `components/ui/` per DESIGN.md (`Button`, `Chip`, `Card`, `Modal`, `Section`, `Tabs`,
   `Menu`, `Field`, `Meter`, `EmptyState`, `Icon`). Reuse the shadcn files already there where they fit. Unit
   tests for logic (Section persistence, Modal focus trap/Esc, Meter thresholds).
4. **Cut `App.tsx`.** Move the shell into `components/shell/{Titlebar,Rail,Sidebar,Content,StatusBar,Overlays}.tsx`
   and state into `state/*` hooks (layout, sessions, sidebar, settings, dialogs). Pure moves: same JSX, same
   behaviour. `App.layoutWriteThrough.test.ts` and the other App-source tests move with the code they pin.
   Target: `App.tsx` under 600 lines.
5. **Navigation contract.** `components/shell/navigation.ts` with `openPlan`, `openInbox`, `openSettings`, `focusTile`
   (stubs calling today's paths). Rail ids and the old-id mapping in `core/ui/sidebar.ts`.

## Done means
- The app looks the same except the token cleanup and the new themes; screenshot each theme in the PR.
- `npm run typecheck` clean; full suite (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`)
  passes with only path updates to pinned tests, each listed in the PR.
- PR into `main`. Do not merge. The 9.2 tabs start after it merges.
