You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/guide.md. Read docs/dev/DESIGN.md (approved in W9-0) in full and open its mockup.
**Run alone** — no other Wave 9 tab runs while this one does.

Worktree + branch (rule 1 in CONTEXT.md): slug `w9-foundation`, branch `refactor/ui-foundation`.

# W9-A — Tokens, primitives, shell split (no visible behaviour change except theming)

0. **Before-screenshots** (moved here from W9-0): run the app alone once and screenshot every current surface for
   the PR, then stop it.
1. **Identity, tokens and themes** (DESIGN.md §9: a new product look, nothing of upstream's). `styles/tokens.css`.
   `core/theme/themes.ts` holds `night` (default), `dusk`, `day` and `system`; every old id maps to `night` (`light` →
   `day`) on load (test it). Bundle IBM Plex Sans and JetBrains Mono as woff2 (OFL; add their licence files) and drop
   Geist. Make the new mark (SVG) and regenerate the app icons in `build/` from it. `lib/theme.tsx` sets
   `data-theme` and `color-scheme`; `tailwind.css` stops forcing `dark`. Extend `contrast.test.ts` to every
   theme.
2. **Split `styles.css`** into `styles/{tokens,base,primitives}.css` plus feature files next to their components.
   Replace every colour literal with a token. Add a test: no hex/`rgb(` outside `tokens.css` in renderer CSS (the
   assistant-ui vendor dir excepted). Keep every selector name the pinned tests read, or update the test's path in
   the same commit with the invariant unchanged.
3. **Primitives** in `components/ui/` per DESIGN.md (`Button`, `Chip`, `Card`, `Modal`, `Nav`, `Tabs`,
   `Menu`, `Field`, `Meter`, `EmptyState`, `Icon`). Reuse the shadcn files already there where they fit. Unit
   tests for logic (Modal focus trap/Esc, Meter thresholds).
4. **Cut `App.tsx`.** Move the shell into `components/shell/{Titlebar,Rail,Sidebar,Content,StatusBar,Overlays}.tsx`
   and state into `state/*` hooks (layout, sessions, sidebar, settings, dialogs). Pure moves: same JSX, same
   behaviour. `App.layoutWriteThrough.test.ts` and the other App-source tests move with the code they pin.
   Target: `App.tsx` under 600 lines.
5. **Navigation contract.** `components/shell/navigation.ts` with `openPage`, `openConsole`, `openPlan`, `openInbox`,
   `openWorktree` and `openSettings` (stubs calling today's paths). Page ids and the saved-state mapping in
   `core/ui/pages.ts`.

## Done means
- The layout is unchanged (pages come in 9.2); colours, fonts, mark and icons are the new identity. Screenshot each
  theme in the PR.
- `npm run typecheck` clean; full suite (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`)
  passes with only path updates to pinned tests, each listed in the PR.
- PR into `main`. Do not merge. The 9.2 tabs start after it merges.
