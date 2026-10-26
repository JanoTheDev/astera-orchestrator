# DESIGN-W13: the VSCode-style workbench

Replaces the look and the shell of `DESIGN-W11.md` (Linear/Raycast, top-bar tabs), which the owner rejected, and
the "no icon rail, no persistent sidebar" line of `DESIGN.md §1`. `DESIGN.md §0` (owner rules) still holds (§15).
Every UI Task of the plan "VSCode-style workbench redesign" builds against this file. When this file and a
component disagree, this file wins. Decisions D1–D11 are the planner's and are closed.

Source of truth for colours: `src/core/theme/themes.ts` (the provider writes them as CSS variables;
`src/renderer/src/styles/tokens.css :root` mirrors Night). Contrast floors: `src/core/theme/contrast.test.ts`.

## 1. Direction

A VSCode "Dark Modern" / "Light Modern" workbench. Flat surfaces separated by 1px borders, no glows, no gradients,
no cards floating on a page. One blue accent for focus, selection, the primary button, badges and progress.
Colour for status only, always with a second cue. Density of an editor: 13px type, 22px tree rows, 35px tabs.
Everything that belongs together is connected (§10): a Task row opens its console, a console names its plan, a
count opens what it counts. No page exists only to hold a list: lists live in the side bar, documents in tabs.

## 2. Workbench layout

```
┌ Title bar 35 ─────────────────────────────────────────────────────────────────────────┐
│ [mac lights]        [ ⌕  Astera-project  ·  Search  Ctrl+Shift+P ]           [– □ ×] │
├────┬─────────────────┬────────────────────────────────────────────────────────────────┤
│ A  │ SIDE BAR        │ EDITOR AREA (PaneGrid groups)                                  │
│ c  │ 170–600, def 260│ ┌ tabs 35 ──────────────────────────────────────────────────┐  │
│ t  │ VIEW TITLE  ⋯ + │ │▔▔▔▔▔▔▔▔▔▔▔▔                                                 │  │
│ i  │ ▾ SECTION  ⟳ ⋯  │ │ Welcome │ T4 · Worker 2 ● │ Plan: Auth rework ×│            ⋯ │  │
│ v  │   row 22        │ ├────────────────────────────────────────────────────────────┤  │
│ i  │   row 22        │ │ editor content (console xterm, view, file)                 │  │
│ t  │ ▸ SECTION       │ │                                                            │  │
│ y  │                 │ └────────────────────────────────────────────────────────────┘  │
│    │                 ├────────────────────────────────────────────────────────────────┤
│ 48 │                 │ PANEL  NEEDS YOU (2)  ACTIVITY  OUTPUT  TERMINAL   35   ⋯ ˄ × │
│    │                 │ panel content (resizable, Ctrl+J)                              │
│ Ac │                 │                                                                │
│ Mg │                 │                                                                │
├────┴─────────────────┴────────────────────────────────────────────────────────────────┤
│ Status bar 22: project ⎇ branch · 2 working · 1 needs you      5h 16% · Host ok · bell│
└───────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Size | Token | Surface | Notes |
|---|---|---|---|---|
| Title bar | 35px high | `--titlebar-h` | `--panel` | drag region; §8 |
| Activity bar | 48px wide | `--activitybar-w` | `--activitybar-bg` | §3 |
| Side bar | 170–600px, default 260px | `--sidebar-w` | `--sidebar-bg` | resizable sash (4px hit area, 1px `--focus-border` while dragging); Ctrl+B toggles; width persists per window |
| Editor area | flex | — | `--editor-bg` | the existing PaneGrid groups (split, drag tabs between groups) |
| Editor tab bar | 35px | `--tab-h` | `--tab-bar-bg` | §5 |
| Bottom panel | 35px header, body resizable (min 100px, default 30% of the editor area) | `--panel-header-h` | `--panel-bg`, top border `--panel-border` | Ctrl+J toggles; §6 |
| Status bar | 22px | `--statusbar-h` | `--statusbar-bg` | §7 |

- Borders: every region meets the next with a 1px `--line` (`--panel-border` above the panel). No shadows on
  regions.
- Minimum window 1024×640. Under 1100px the side bar opens as an overlay over the editor instead of pushing it.
- The side bar and panel remember open/closed and size per window (`localStorage`, wrapped in try/catch).

## 3. Activity bar

- 48px wide, items 48×48, icon 24px (lucide, 1.5 stroke) centred.
- Inactive item: `--activitybar-fg-dim`. Hover: `--activitybar-fg`. Active: `--activitybar-fg` plus a 2px
  `--accent` bar on the left edge, full item height. No background on any state.
- Clicking the active item collapses the side bar (VSCode behaviour); clicking another switches the view and opens
  the side bar.
- Badge: a count bottom-right of the icon, `--badge-bg` / `--badge-fg`, `--fs-11`/600, min 16px, `--radius-pill`,
  "9+" above 9, hidden at 0. The item's `aria-label` includes the count.
- Order, top to bottom (D3); `Ctrl+1…6` open the first six views (Devices, the seventh, has no digit key):

| # | View | Icon (lucide) | Badge |
|---|---|---|---|
| 1 | Agents (consoles) | `TerminalSquare` | consoles that need you |
| 2 | Plans | `ListTree` | plans waiting for approval |
| 3 | Explorer | `Files` | — |
| 4 | Source Control | `GitBranch` | changed files of the current worktree |
| 5 | History | `History` | — |
| 6 | Run | `Play` | running configs |
| 7 | Devices | `Laptop` | paired devices that are offline or have an account to sign in |
| bottom | Accounts | `CircleUser` | warn dot when an account is near its limit |
| bottom | Manage | `Settings` | dot when an update is ready |

- **Accounts** opens a popover (`ui/Popover`): one row per account with its 5-hour and weekly `Meter`, the active
  account marked, "Manage accounts…" → `view:settings:accounts`.
- **Manage** opens a `Menu`: Settings (Ctrl+,), Keyboard shortcuts (`view:settings:keys`), Help, Check for updates.
- The bar is a `role="tablist"` with `aria-orientation="vertical"`; arrows move, Enter/Space activates.

## 4. Side bar views

Every view: a 35px **view title** (`--fs-11`/600 uppercase, +0.04em, `--text-dim`, 20px left padding) with the
view's toolbar on the right (icon buttons, 22px, shown always for the view title). Below it, collapsible
**view panes** (§12): each with its own header and hover actions, collapsed state remembered per view. A pane with
nothing to show uses the empty view pattern (§12).

### Agents
Sections: **Needs you**, **Working**, **Finished**. Toolbar: Open a console (+), filter (scope: this project / all projects).
- Row (24px, `--list-row-h`): state icon (needs-you `CircleAlert` warn, working `Loader` spinning accent,
  finished `CheckCircle2` ok, failed `XCircle` danger), console title, then dim `plan › task`, account on the
  right (`--fs-11` faint). Click opens the console's tab. Context menu: Open, Open to the side, Copy session id,
  Close console (confirm).
- Finished keeps the last 20 and offers "Show all" → History.

### Plans
A tree **Project › Plan › Step › Task** (22px rows). Plan row: status icon, name, a 40px progress `Meter`, count
"4/9". Step row: "Step 2", count. Task row: state icon, task title, console dot when one runs.
- Toolbar: **New plan** (+, opens `view:start`), filter (text), collapse all, **Group by** menu: None (default),
  Status (the former "All tasks" kanban: groups Queued / Running / Needs you / Done / Failed), Area (the former
  "By area"), Overlap (the former "Overlap" tab).
- A pinned **Main plan** pane above the tree: the project's main plan in two lines and "Open" →
  `view:mainplan`.
- Click a plan → `view:plan:<jobId>`. Click a Task → §10. Context menu on a plan: Open, Edit plan settings… (§13),
  Pause / Resume, Cancel (confirm). On a task: Open console, Show in plan, Retry (failed only).

### Explorer
Panes **Files** (the existing file tree, 22px rows, file-type icons) and **Changed** (files changed in the current
worktree, git status letter on the right in its `--git-*` colour plus the letter). Toolbar: New file, New folder,
Refresh, Collapse all. Click opens a file tab.

### Source Control
Panes **Worktrees** (one row per worktree: branch in mono, plan › task dim, reachable mark; unreachable rows
grouped last under one warn line) and **Changes** (the selected worktree's changed files). Click a worktree →
`view:worktree:<path>`; click a file → its diff tab. Row hover actions: Open folder, Delete (confirm).

### History
Panes **Sessions** (past consoles, newest first: title, plan › task, age) and **Work records** (the former "How it
works" records: one row per record). Click opens the session's summary / the record in a tab. Toolbar: filter.

### Run
One pane **Configurations**: one row per run config with inline Run (`Play`) / Stop (`Square`) on hover and always
while running (then a spinner in the state slot). Output streams to the panel's Output tab. Toolbar: Add
configuration, Refresh.

### Devices
Panes **This computer** (one row: whether it accepts work from other devices; click or its gear opens
`view:settings` at the `remote` anchor), **Your devices** (paired Runtimes: state icon online `CircleCheck` /
offline `ServerOff` / not asked yet `Circle`, name, OS dim, account count on the right, a warn decoration when it is
offline or an account needs a sign-in; click opens `view:device:<runtimeId>`) and **Found on your network** (devices
found by LAN beacon or Tailscale and not paired: name, address and source dim, inline Add on hover; Enter adds).
Toolbar: Add device (+), Refresh. Empty panes use the empty view pattern (§12) with the Add button.
- **Add device** is one `Modal` with a numbered step strip and one primary button per step: **Choose** (a found
  device prefills `user@host` with this computer's user name, or type an address, or the Pairing string tab; full
  control on by default with one hint line; "Linux (Ubuntu or Debian) and Windows" said once), **Connect & set up**
  (`MachineSteps` live), **Bring my setup** (what moves, each kind pre-checked, one Copy button), **Done** ("Open a
  console on <name>"). When the add fails because sudo needs a password or the SSH key is not on the device, the
  step shows the exact command and its primary is **Run in a terminal**, which opens a panel terminal running it.
- Settings › Remote Runtimes keeps only This computer as a Runtime and links here ("Your devices · Open Devices").

## 5. Editor tabs and the `view` tab kinds

- Tab: 35px, padding 0 10px, icon 16px, label `--fs-13`, max 240px with ellipsis, min 80px.
- Inactive: `--tab-inactive-bg`, `--text-dim`. Active: `--tab-active-bg`, `--text`, a 1px `--tab-border-active`
  **top** border (2px in the focused group only), no bottom border so the tab joins the editor. Inactive group's
  active tab: `--text` with no accent border.
- Close `X` (16px icon button, `aria-label`): shown on hover and on the active tab; a dirty or live tab shows a
  dot (8px, `--text`) in its place until hover. Middle-click closes.
- Tab bar overflow scrolls horizontally; a `⋯` menu on the right lists all tabs of the group.
- New tab kind `view` (D2): `{ kind: 'view', view: '<name>', arg?: string }`. One tab per view and argument;
  opening it again focuses the existing tab.

| View id | Title | Icon | Content |
|---|---|---|---|
| `welcome` | Welcome | `Sparkles` | shown when nothing is open: recent plans (5), New plan, Open a console, the six keys of §9 |
| `plan:<jobId>` | plan name | `ListTree` | goal, Plan settings (§13), steps and tasks, log |
| `mainplan` | Main plan | `Target` | the project's main plan |
| `start` | New plan | `Plus` | the Start flow (content owned by other plans, unchanged) |
| `settings[:anchor]` | Settings | `Settings` | the settings editor (§12), scrolled to `anchor` |
| `worktree:<path>` | branch name | `GitBranch` | worktree detail: branch, path, changes, keep/delete |
| `device:<runtimeId>` | device name | `Laptop` | settings-row detail: status (Check now), address, permission, accounts (Sign in), projects (Add project); New console, Copy my setup again, Unpair (confirm) |

## 6. Bottom panel

- Header 35px: tabs as uppercase `--fs-11`/600 labels, active = `--text` + 1px `--accent` underline, inactive
  `--text-dim`; right side: panel actions of the active tab, Maximise (`ChevronUp`), Close (`X`).
- Tabs, in order: **Needs you** (count in a badge; the former Inbox: one row per decision, kind chip, project ›
  plan · task, age, its one inline action Approve / Answer / Open; "Handled for you" below, grouped by day),
  **Activity** (the coordinator's event log, one line per event), **Output** (run-config and host output, a
  channel `Select`), **Terminal** (plain shell terminals, xterm).
- The panel never opens by itself (§15). A new Needs-you item only changes the badge and plays the sound.

## 7. Status bar

22px, `--statusbar-bg`, `--statusbar-fg`, `--fs-12`, items 22px high with 8px padding, hover `--wash`.
Left to right:

1. Project name + `GitBranch` + branch (mono) → Source Control view.
2. Working count (`Loader` + "2 working") → Agents view.
3. Needs-you count (`CircleAlert` + "1 needs you", warn colour) → panel's Needs you tab.

Right group:

4. Accounts usage ("5h 16% · week 40%") → Accounts popover.
5. Host state as a word ("Host ok" / "Host offline" in `--danger`).
6. Bell (`Bell`, unread dot) → panel's Needs you tab.

- Zero counts are hidden. The bar is accent-tinted (`--accent` background, `--accent-ink` text) only in a remote
  or alert state (Host offline, a remote session), never otherwise.

## 8. Title bar and command center

- 35px, `--panel`, 1px `--line` below, the whole bar is a drag region except its controls.
- Centre: the **command center** field, 38% of the width (min 240, max 600), 24px high, `--elevated`
  background, 1px `--line-strong`, `--radius`: `Search` icon, project name (600) · "Search" hint · `Kbd`
  Ctrl+Shift+P. Click opens the command palette (§9) prefilled for projects; its chevron opens the project
  switcher menu (search, project rows with colour dot, `Ctrl+Alt+N` hint, "Open project…").
- Left: macOS traffic lights (78px inset); nothing else. Right on Linux and Windows: window controls, 46×35 each,
  close hover `--danger` with `--ink-white`.

## 9. Palette and keys

- The command palette is an alias of the existing command box: one input at the top centre, 600px wide, list rows
  24px, the chord right-aligned in `Kbd`. Prefixes: `>` commands (default via Ctrl+Shift+P), none = quick open
  (Ctrl+P: open tabs, then files), `@` consoles, `#` plans.
- Commands include: New plan, Open a console, Edit plan settings…, Toggle side bar, Toggle panel,
  every activity view, Settings, Keyboard shortcuts, Check for updates.

| Key | Action |
|---|---|
| Ctrl+B | toggle side bar |
| Ctrl+J | toggle panel |
| Ctrl+Shift+P | command palette |
| Ctrl+P | quick open (tabs and files) |
| Ctrl+, | `view:settings` |
| Ctrl+1…6 | activity views 1–6 (§3) |
| Ctrl+Alt+1…9 | switch project (unchanged) |
| Ctrl+Shift+N | new window (unchanged) |

All are rebindable in Keyboard shortcuts. macOS uses Cmd for Ctrl.

## 10. Connected flows (D5)

- Plans tree Task click: opens its console tab when a console runs for it; otherwise `view:plan:<jobId>` scrolled
  to the Task (the Task row flashes `--list-active` once, 600ms; none under reduced motion).
- A console tab has a slim header (§12) naming its plan › Task; both are links (plan → plan tab, Task → plan tab
  scrolled to it).
- A Needs-you row opens `view:plan:<jobId>` scrolled to the question.
- Every status bar count opens the view or panel tab it counts (§7).
- One "New plan" entry: the palette command and the Plans view's +, both opening `view:start`. "Open a console"
  is a separate command and the Agents view's +.
- Worktree row → `view:worktree:<path>`.

## 11. Visual language (D6)

### Palette

Keep the theme ids so saved choices survive: **Night** = Dark Modern, **Dusk** = a softer blue-grey dark with the
same structure, **Day** = Light Modern. `system` follows the OS (night/day).

| Token | Night | Dusk | Day | Use |
|---|---|---|---|---|
| `--bg` | `#1f1f1f` | `#1e2430` | `#ffffff` | editor ground (= `--editor-bg`) |
| `--panel` | `#181818` | `#191e28` | `#f8f8f8` | title bar, side bar, panel, status bar |
| `--elevated` | `#2b2b2b` | `#2b3240` | `#e5e5e5` | inputs, secondary button fill, chips, menus |
| `--hover` | `#2a2d2e` | `#262d3a` | `#f2f2f2` | row hover (= `--list-hover`) |
| `--term-bg` | `#181818` | `#191e28` | `#ffffff` | terminals |
| `--line` | `#2b2b2b` | `#2c3341` | `#e5e5e5` | 1px borders between regions |
| `--line-strong` | derived | derived | derived | control borders |
| `--text` | `#cccccc` | `#d3d9e3` | `#3b3b3b` | body text |
| `--text-dim` | `#9d9d9d` | `#a1aabb` | `#5f5f5f` | labels, inactive tabs, view headers |
| `--text-faint` | `#8b8b8b` | `#8790a2` | `#717171` | meta only (time, counts, hints) |
| `--accent` | `#0078d4` | `#1f76cc` | `#005fb8` | focus, selection marker, primary button, badge, progress |
| `--accent-ink` | `#ffffff` | `#ffffff` | `#ffffff` | text on `--accent` |
| `--accent-soft` | `#0f2b46` | `#11263d` | `#dbeaf9` | selected row / active chip wash (= `--list-active`) |
| `--link` | `#4daafc` | `#62b0f5` | `#005fb8` | links and accent-coloured words |
| `--ok` / `--ok-soft` | `#6cc77a` / `#13291a` | `#72c98a` / `#162b22` | `#2a7a2e` / `#e6f3e7` | status |
| `--warn` / `--warn-soft` | `#d7ac2c` / `#2e2810` | `#dcb43e` / `#302a16` | `#8a6100` / `#fbf0d4` | status |
| `--danger` / `--danger-soft` | `#f47070` / `#3a1c1c` | `#f27a7a` / `#3b2228` | `#c42b2b` / `#fbe4e4` | status |
| `--info` / `--info-soft` | `#4daafc` / `#122436` | `#62b0f5` / `#172a3f` | `#005fb8` / `#dfebf7` | status |
| `--activitybar-bg` | `#181818` | `#191e28` | `#f8f8f8` | activity bar |
| `--activitybar-fg` | `#d7d7d7` | `#d3d9e3` | `#1f1f1f` | active / hovered icon |
| `--activitybar-fg-dim` | `#868686` | `#7f889a` | `#6e6e6e` | inactive icon |
| `--sidebar-bg` | `#181818` | `#191e28` | `#f8f8f8` | side bar |
| `--editor-bg` | `#1f1f1f` | `#1e2430` | `#ffffff` | editor area |
| `--tab-bar-bg` | `#181818` | `#191e28` | `#f8f8f8` | editor tab strip |
| `--tab-active-bg` | `#1f1f1f` | `#1e2430` | `#ffffff` | active tab |
| `--tab-inactive-bg` | `#181818` | `#191e28` | `#f8f8f8` | inactive tab |
| `--tab-border-active` | `#0078d4` | `#1f76cc` | `#005fb8` | active tab's top border |
| `--panel-bg` | `#181818` | `#191e28` | `#f8f8f8` | bottom panel |
| `--panel-border` | `#2b2b2b` | `#2c3341` | `#e5e5e5` | border above the panel |
| `--statusbar-bg` | `#181818` | `#191e28` | `#f8f8f8` | status bar |
| `--statusbar-fg` | `#cccccc` | `#d3d9e3` | `#3b3b3b` | status bar text |
| `--focus-border` | `#0078d4` | `#1f76cc` | `#005fb8` | focus outline, sash while dragging |
| `--list-hover` | `#2a2d2e` | `#262d3a` | `#f2f2f2` | row hover |
| `--list-active` | `#0f2b46` | `#11263d` | `#dbeaf9` | selected row in a focused list |
| `--list-inactive-selection` | `#37373d` | `#323a4a` | `#e4e6f1` | selected row in an unfocused list |
| `--badge-bg` / `--badge-fg` | `#0078d4` / `#ffffff` | `#1f76cc` / `#ffffff` | `#005fb8` / `#ffffff` | count badges |

Rules:
- **Accent is a fill and a mark, not text.** On Night and Dusk `--accent` is 3.3–3.6:1 on the ground: fine for a
  marker, border, icon or progress, too weak for words. Accent-coloured words use `--link`. A selected row or
  active chip is `--text` on `--accent-soft`, with the 2px `--accent` marker.
- At most one filled accent button per view.
- Status colours only for status, always with an icon or a word.
- **One colour per status, everywhere** (`ui/statusTone.ts`; glyphs, chips, bands, graph, board, dots): waiting
  (pending, ready) `--text-dim` (pending `--fi-mute`) · running (dispatched) `--info` · checking (validating,
  reviewing, merging) `--fi-purple` · done `--ok` · failed `--danger` · blocked / needs you `--warn`. Idle is
  neutral, never `--ok`. Task kinds use `--fi-*` hues only, never one of these.
- Fixed colours (PR, git, file types, brand, roles, agent violet, syntax) stay in `tokens.css` as they are.
- Older token names (`--rail`, `--surface-hover`, `--btn-bg`, `--status-bg`, …) keep working; they derive from the
  tokens above (`core/theme/apply.ts`).

Contrast floors (tested per theme): `--text` ≥ 7:1 on `--bg` / `--editor-bg` / `--term-bg`, ≥ 4.5:1 on every
other surface it is read on (panel, side bar, tabs, list hover/active/inactive selection, `--accent-soft`);
`--text-dim` ≥ 4.5:1 on `--bg`, `--panel`, `--elevated`, inactive tabs; `--text-faint` ≥ 3:1; `--link` ≥ 4.5:1;
ink on accent and badge text ≥ 4.5:1; status text on its soft ≥ 4.5:1; icons, markers and borders ≥ 3:1.

### Type

Face: the system UI stack `system-ui, -apple-system, "Segoe UI", Ubuntu, Cantarell` + the Hangul faces
(`SANS` in `themes.ts`). JetBrains Mono (`--mono`) for code, ids, paths and branch names only. The bundled IBM
Plex Sans files stay on disk unused until the cleanup Task decides.

| Token | Size / weight | Use |
|---|---|---|
| `--fs-22` | 22 / 600 | Welcome headline only |
| `--fs-18` | 18 / 600 | a view tab's document title (plan name) |
| `--fs-15` | 15 / 600 | section title inside a view tab, modal title |
| `--fs-14` | 14 / 500 | settings-editor row title |
| `--fs-13` | 13 / 400 | **body** (set on `body`), tree and list rows, tabs, menus, inputs |
| `--fs-12` | 12 / 400 | status bar, descriptions, chips, hover text |
| `--fs-11` | 11 / 600 | view and pane headers (uppercase, +0.04em), panel tab labels, badges, kbd |

Line height `--lh` 1.45 for prose, `--lh-tight` 1.25 for single-line rows. Numbers `tabular-nums`. Weights 400,
500, 600 (`--fw-*`).

### Sizes, spacing, radius, focus, elevation, motion

- Heights: tree row `--row-h` 22, list row `--list-row-h` 24, tab `--tab-h` 35, panel header
  `--panel-header-h` 35, title bar `--titlebar-h` 35, status bar `--statusbar-h` 22. Controls: `--h-sm` 24
  (inputs and buttons in views), `--h-md` 30 (settings editor, modals), `--h-lg` 36 (Start's primary).
- Tree indent 8px per level plus a 16px twistie; guides 1px `--line` shown on hover of the tree.
- Space: 4px grid (`--sp-*`). View content padding 8px horizontal (20px under a view title); tab content 16–24px.
- Radius: `--radius-sm` 3 (badges in rows, kbd), `--radius` 4 (controls, buttons, inputs, menu items),
  `--radius-lg` 6 (menus, popovers, hovers, cards), `--radius-xl` 8 (modals), `--radius-pill` (count badges).
- Focus: `:focus-visible` only, VSCode's 1px focusBorder: `--focus-ring` (1px `--bg` gap + 1px
  `--focus-border`) on controls, `--focus-ring-inset` on tree and list rows so a scroller cannot clip it.
- Elevation: regions are flat (level 0, 1px borders). Menus, popovers, hovers, the palette: `--shadow-pop`.
  Modals: `--shadow-modal` over `--scrim`. Nothing else casts a shadow.
- Motion: `--dur-fast` 90ms colour changes, `--dur` 150ms menus and the panel/side bar toggle (no slide; fade
  only), `--ease-out`. Only live progress moves by itself. Reduced motion zeroes `--motion`.
- Icons: lucide through the `Icon` registry; 24px in the activity bar, 16px in rows, tabs and toolbars, 14px in the
  status bar. An icon-only button always has a label.

## 12. Component patterns

- **Tree row** (22px): indent, twistie (`ChevronRight`, rotates 90° open), 16px icon, label (`--fs-13`,
  ellipsis), dim description, right-aligned hover actions (16px icon buttons) replacing the meta on hover.
  Hover `--list-hover`; selected `--list-active` when the tree has focus, `--list-inactive-selection` otherwise;
  focused row `--focus-ring-inset`. `role="tree"` / `treeitem`, arrows and Enter.
- **List row** (24px): same as a tree row without indent and twistie.
- **View pane header** (22px): twistie, title `--fs-11`/600 uppercase `--text-dim`, optional count badge, hover
  actions on the right (shown on hover or focus-within only). Top border 1px `--line` except the first pane.
- **Editor tab**: §5.
- **Empty view** (VSCode welcome view): one sentence `--fs-13` `--text-dim`, then one full-width primary
  `Button` (`--h-sm`), 8px gaps, padding 8px 20px. No icon, no headline.
- **Settings editor rows**: settings is a tab, not a modal. Left a 200px table of contents (list rows), right
  content at 720px max: a search field on top; each row = title (`--fs-14`/500, with its category dim before it),
  one description line (`--fs-12` `--text-dim`), the control under it (VSCode layout); modified rows get a 2px
  `--accent` left marker. `settings:<anchor>` scrolls to and flashes the row.
- **Context menus**: the `Menu` primitive at the pointer; rows 24px, label left, chord right (`--text-faint`),
  separators 1px `--line`, `--radius-lg`, `--shadow-pop`, `--elevated` background. Destructive items last, in
  `--danger`, and confirm.
- **Console tab header** (24px, `--panel`, 1px `--line` below): state icon, plan › Task as links (`--link`),
  account and age (faint) on the right, then the console's actions (Open to the side, Copy id, Close). The xterm
  fills the rest; the TUI is never wrapped or restyled.

## 13. Plan settings (D7)

Editable while a plan runs. A "Plan settings" section of `view:plan:<jobId>` and behind "Edit plan settings…"
(Plans tree context menu and the palette, which opens the plan tab scrolled to the section). Shown in simple mode
too. Rows use the settings-editor pattern (§12).

| Setting | Control | Editable |
|---|---|---|
| Workers at once | number stepper 1…the app-wide cap | always |
| Priority | Select: low / normal / high | always |
| Review rounds | number stepper 0…3 | always; applies to Tasks not yet reviewed |
| Replan between steps | toggle | always |
| Auto-approve | toggle | always |
| Hands-off | toggle | always |
| Delivery | Select: pull request / push | until delivery has started |

A field that can no longer change is read-only (`aria-readonly`, `--text-dim`) and its description line says why
("Delivery has started."). Changes save on change, no Save button; a failed save reverts the field and shows the
error on its row.

## 14. What was removed and where it went (D4)

No feature is deleted; each moves.

| Removed | Now |
|---|---|
| Top-bar page tabs and the More menu | activity bar (§3) |
| "All tasks" kanban page | Plans view › Group by: Status |
| Main plan page | Plans view's Main plan pane + `view:mainplan` tab |
| "By area" and "Overlap" tabs | Plans view › Group by: Area / Overlap |
| Browser page | browser tabs open from links and the palette |
| Inbox page | panel's Needs you tab; the bell moves to the status bar |
| Settings, Start, Worktrees, History, Run configs, How it works pages | `view` tabs (§5) and side bar views (§4) |
| PageHeader on every page | view titles, pane headers and the tab title |

## 15. Owner rules kept from DESIGN.md §0

- Consoles are the real Claude Code / Codex CLI TUI in xterm, never a custom chat UI.
- Nothing pops up by itself: no modal, panel or side bar opens unless the owner acts. Only Needs-you items
  notify, with a sound and a badge.
- Hands-off by default: plans run by themselves; the owner answers in Needs you or the worker's own console,
  never by typing into the coordinator.
- Ended consoles close on their own and leave a summary.
- Every console is one row in the Agents view and opens as its own tab; the app opens on Welcome when nothing is open.
