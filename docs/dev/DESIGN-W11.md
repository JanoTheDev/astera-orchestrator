# DESIGN-W11: the visual direction

Replaces the look of `DESIGN.md` (Wave 9), which the owner rejected. `DESIGN.md §0` (owner rules) still holds:
consoles are the real CLI TUI, nothing pops up by itself, the app opens on Agents, hands-off by default.
Everything else visual is decided here. Page Tasks build against this file; when this file and a page disagree,
this file wins. Problems this answers are listed per shot in `docs/dev/shots/w11-before/NOTES.md`.

## 1. Direction in one paragraph

A calm, dense, professional desktop tool in the Linear / Raycast family. Neutral graphite surfaces, **one** accent
per theme used sparingly (primary action, selection, focus, live progress), colour for status only, never for
decoration. Hierarchy comes from type weight, size and spacing, not from borders and boxes. Every page has the same
skeleton (§7), so the person always knows where the title, the main action and the filters are. Quiet by default:
no glows, no gradients, no lime.

## 2. Palette

Source of truth: `src/core/theme/themes.ts` (the provider writes them as CSS variables; `styles/tokens.css :root`
mirrors Night). Contrast floors are tested in `core/theme/contrast.test.ts`.

| Token | Night | Dusk | Day | Use |
|---|---|---|---|---|
| `--bg` | `#0e0f12` | `#13141b` | `#f4f4f6` | page ground |
| `--panel` | `#15161a` | `#1a1b24` | `#ffffff` | top bar, status bar, cards, inputs, side lists |
| `--elevated` | `#202227` | `#252633` | `#eaebee` | menus, secondary button fill, chips |
| `--hover` | `#1a1b20` | `#20212b` | `#eff0f2` | row hover |
| `--term-bg` | `#0b0c0e` | `#0f1016` | `#ffffff` | terminals |
| `--line` | `#26282e` | `#2b2c38` | `#dcdee3` | hairlines between areas |
| `--line-strong` | derived | derived | derived | control borders, card borders on Day |
| `--text` | `#eceef2` | `#efedf5` | `#16171b` | primary text |
| `--text-dim` | `#a2a6b0` | `#aaa7b8` | `#4d515b` | secondary text, labels, inactive tabs |
| `--text-faint` | `#7c818c` | `#858296` | `#666a75` | meta (time, counts, hints); never body copy |
| `--accent` | `#8b93ff` indigo | `#f2a65e` amber | `#4a52d0` indigo | primary, selection, focus, progress |
| `--accent-ink` / `--accent-soft` | ink on accent / selected-row wash | | | |
| `--ok` / `--warn` / `--danger` / `--info` (+ `-soft`) | | | | status only, always with an icon or word |

Rules:
- **Accent budget:** at most one filled accent button per view (the primary action) plus selection/focus marks.
  Active tabs are `--text` with an accent underline, not accent text.
- Day separates page from panel with `--line-strong` borders and `--shadow-sm`, not by tint alone (the cream
  page and near-white panels of W9 are gone).
- Status needs a second cue (icon, word, or dot + label); colour alone never carries meaning.
- Fixed colours (PR, git, file types, brand, roles, agent violet) stay as they are in `tokens.css`.

## 3. Type

Face: IBM Plex Sans (UI), JetBrains Mono (code, ids, paths, branch names only — never for prose, counts or times).

| Token | Size / weight | Use |
|---|---|---|
| `--fs-22` | 22 / 600 | empty-state headline, Start page question |
| `--fs-18` | 18 / 600 | page title (PageHeader) |
| `--fs-15` | 15 / 600 | section title, modal title, card title on big cards |
| `--fs-14` | 14 / 500 | emphasised body (list row title) |
| `--fs-13` | 13 / 400 | body, controls, menus — the default |
| `--fs-12` | 12 / 500 | labels, chips, tabs in dense bars, status bar |
| `--fs-11` | 11 / 500 | meta: timestamps, counts, kbd, uppercase overlines (+0.04em tracking) |

Line height `--lh` 1.45 for prose, `--lh-tight` 1.25 for titles and single-line rows. Numbers use
`font-variant-numeric: tabular-nums`. Weights: 400, 500, 600 only (`--fw-*`).

## 4. Spacing, sizing, radius

- Space on a 4px grid: `--sp-1` 4 … `--sp-8` 32, `--sp-10` 40, `--sp-12` 48. Inside a control 8–12, between
  related controls 8, between groups 16–24, page padding `--page-pad` 24.
- Control heights: `--h-sm` 24 (dense toolbars, chips), `--h-md` 30 (default), `--h-lg` 36 (primary on Start, modal footers).
- Radius: `--radius-sm` 4 (chips, kbd), `--radius` 6 (buttons, inputs, menu items), `--radius-lg` 10 (cards, menus,
  popovers), `--radius-xl` 14 (modals), `--radius-pill` (dots, count badges).
- Content width: list and form pages centre at `--page-max` 1180; board pages (Agents, Tasks) and split pages
  (Inbox, Worktrees, Files) use the full width.

## 5. Elevation

| Level | Token | Use |
|---|---|---|
| 0 | none | page, top bar, status bar (separated by a `--line` hairline) |
| 1 | `--shadow-sm` | cards on Day, a hovered card |
| 2 | `--shadow-pop` | menus, popovers, tooltips (hairline ring + shadow) |
| 3 | `--shadow-modal` | modals, over `--scrim` |

## 6. Motion and iconography

- Motion: `--dur-fast` 90ms for hover/press colour, `--dur` 150ms for menus/modals (fade + 4px rise),
  `--ease-out`. Nothing moves on its own except live progress; `prefers-reduced-motion` zeroes `--motion`.
- Icons: lucide only, 16px in controls and rows, 14px in dense bars and chips, 1.75 stroke, `currentColor`.
  An icon-only button always has a `title`/`aria-label` (Tooltip). Never emoji, never ✕/⇅ glyph characters.
- Focus: `box-shadow: var(--focus-ring)` on `:focus-visible` only, everywhere. No outline on mouse focus.

## 7. Page layout pattern (every page)

```
┌ TopBar (shell) ─────────────────────────────────────────────────────────────┐
│ [Project ▾] │ Agents Tasks Plans Inbox Worktrees Files    [search] [usage] [New] [⚙] │
├─────────────────────────────────────────────────────────────────────────────┤
│ PageHeader: Title  · count/subtitle                 [secondary] [Primary]   │
│             filters row: Tabs (segmented) + Chips + search      [view opts] │
├─────────────────────────────────────────────────────────────────────────────┤
│ Content (list / board / split)                                              │
│   empty → EmptyState: icon, one-line headline, one sentence, primary action │
├ StatusBar ──────────────────────────────────────────────────────────────────┤
```

- `PageHeader` (components/ui) is mandatory: `title`, optional `subtitle`/count, `actions` (right: at most one
  primary `Button`, secondaries as `variant="ghost"`), optional `filters` row underneath. 24px horizontal
  padding, 16px top, 12px bottom, hairline under the filters row only when content scrolls under it.
- **One filter control per kind:** a scope choice is `Tabs variant="segmented"`; a removable or toggled filter is
  a `Chip`; never three styles for one job. Filters live in the header, never in a second bar.
- Settings-like choices that are not about browsing (e.g. Plans' "When a plan is done") go to Settings or into a
  Menu behind a "View options" icon button, not above a list.
- Empty states: `EmptyState` with a lucide icon, a headline (`--fs-15`), one sentence, and the page's primary
  action. One empty state per page, never one per column.
- Lists: rows 36px (title `--fs-13`/500, meta `--fs-11` faint on the right), hover `--hover`, selected
  `--accent-soft` with a 2px accent marker. Destructive row actions appear on hover/overflow only and confirm.

## 8. Shell

- **Top bar** (`--topbar-h` 44, `--panel`, hairline below), left to right:
  1. Brand mark (18px) — on macOS after the traffic lights.
  2. **Project switcher**: a real button `[● colour dot] Project name ▾` with a "Project" overline only in its
     tooltip; opens a searchable menu: search field, "All projects" view option, separator, project rows (dot,
     name, count only when > 0, `Ctrl+Alt+N` hint, check on current), separator, "Open project…". Per-project
     actions (new window, settings) live in a row's hover overflow, not as extra sections.
  3. Vertical hairline, then page tabs (`--fs-13`/500, dim; active = `--text` + 2px accent underline). At narrow
     widths tabs drop labels to icons before folding into a menu.
  4. Right: search (a field-shaped button with `Ctrl+K` Kbd), usage meter (label + percent, e.g. "5h 16%"),
     New (the one filled accent button in the bar), settings icon button. Window controls (Linux/Windows) after
     a hairline.
- **Status bar** (`--statusbar-h` 26, `--panel`, `--fs-12` sans, not mono): left group = work ("2 working ·
  1 needs you" as clickable items with dots), right group = usage ("5h 16% · week 40%") and the host state as a
  word ("Connected" / "Host offline", warn colour only when not ok). Zero counts are hidden.
- Settings is a page: when it is open no page tab is marked.

## 9. Per-page intent (what the person needs first)

- **Agents** (home): which consoles need me now, then which are working. Header: title, segmented
  "All / Needs you / Working / Done", project/plan scope as Chips; primary "New console". Cards in a responsive
  grid (min 360px), title = task or agent name, meta = project · account · last activity; terminal preview
  below. Empty: "No consoles yet" + New console.
- **Tasks**: what is moving and what is stuck. Board with column backgrounds (`--panel`, 10px radius) and counts;
  one page-level empty state when every column is empty; primary "New task". Columns scroll horizontally under
  1100px.
- **Plans / Plan**: list of plans with status, progress meter and last activity; primary "New job", secondary
  "From a source". A Plan page shows the goal, then the task board, then the log. "By area / Overlap" is a
  segmented control with a one-line explanation as its tooltip.
- **Inbox**: decisions waiting for me first and only. Single column; "Needs you" items as cards with the action
  inline; "Handled for you" below, grouped by day, one line per event (title + plan + time), objective in the
  row's expanded view only. Empty "Needs you" collapses to one line ("Nothing needs you").
- **Start**: a page (the New tab shows as active), not a modal. One question at `--fs-22`, the goal textarea,
  mode as a segmented choice with one description line, a compact options row, and one `--h-lg` primary button
  that stays visible (sticky footer). Back is a ghost button with an arrow at the header's left.
- **Worktrees**: find a worktree and decide keep/delete. Split: list with search and "Reachable only" chip,
  unreachable rows grouped at the bottom with one warning; detail on the right with branch, path, changes.
- **Files**: browse and open files of the project. Explorer left with labelled icon buttons; the main area is
  the file viewer/editor; a console is a separate tab, not the default content.
- **Settings**: change one thing fast. Side nav with icons (200px), content at 720px max, each section a
  `Section` card with rows "label + help left, control right"; shortcuts as a searchable table with the chord
  next to its name.

## 10. Primitives (components/ui)

Use these; do not hand-roll a `<button>` with its own CSS. Usage notes are in `components/ui/README.md`.
Button (primary / secondary / ghost / danger; sm / md / lg), IconButton, Input, Select, Textarea, Field, Card,
Chip, Badge, Tabs (underline / segmented), Menu, Modal, EmptyState, PageHeader, Section, Kbd, Tooltip, Meter,
Nav, Icon.

Vendored shadcn files (`button.tsx`, `dialog.tsx`, `textarea.tsx`, `tooltip.tsx`, `avatar.tsx`,
`collapsible.tsx`, `skeleton.tsx`) still have importers in `components/assistant-ui/` and
`components/conversation/` (ChatRequestCard, PendingBanner, QuestionCard, ToolRow) and stay until those move to
the house primitives. Tailwind stays for those files only; new code uses the house CSS.
