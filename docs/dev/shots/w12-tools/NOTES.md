# W12 tools: run tools, bottom panel and the legacy Jobs view

Code-only pass (no dev app, no shots). The final visual-check Task shoots this screen. `w12-before/tools/` is empty
(the before pass could not reach a run), so compare against the descriptions below.

## What changed

All controls in these files are now house primitives from `components/ui`. The files have no raw `<button>`,
`<select>`, hand-made menu or listbox, `window.confirm`, hand-drawn SVG or glyph-character icon.

### Bottom panel (BottomPanel, RunToolRail, RunFindBar, RunToolbar, RunPanel)
- Tab close (✕), new terminal (+), clear and collapse are `IconButton size="sm"` (icons: close, add, Delete, chevronDown).
  The tabs stay `role="tab"` spans; they get a `:focus-visible` ring.
- Rail: rerun, stop, scroll to end, clear, find are `IconButton size="sm"` (24px); find uses `active` + `aria-pressed`.
- Find bar: the text box is the ui `Input` (standard border and focus ring); previous / next / close are `IconButton`s.
- Title-bar toolbar: run and stop are `IconButton`s (30px, was 28px). The ⋮ menu is `Menu` (trigger mode, align end).
  The running-list badge opens a `Popover`; each row's jump and stop are `data-roving` buttons.
- RunPanel has no controls; unchanged.

### Run configurations (RunConfigManager, RunConfigForm, RunConfigMenu, RunTypePicker, ConfigRefList, EnvTable, RuntimeSelector)
- Manager tools (remove, duplicate, new folder, up, down) are labelled `IconButton`s; tree rows are ghost `Button`s with
  `aria-current` on the selected row.
- Kind picker (＋): `Popover` with the search `Input` on top, the "Detected in this project" and "Other" headings,
  rows as ghost buttons. Search still matches any part of the label or the type id.
- Form: the 7 Browse buttons are `Button`s with a folder icon; "Add option" is a `Menu` (disabled when nothing is left).
- Config pill menu (toolbar): `Popover` (controlled, so the `run.selectConfig` shortcut still opens it); rows and footer
  are buttons, each row's run button is an `IconButton` "Run: <name>". Recent and groups kept.
- References: each one is a `Chip` (danger tone when broken) with a remove `IconButton`; "Add" is a `Menu`.
- Env table: remove row `IconButton` (still out of the Tab order, as before), add row ghost `Button`.
- RuntimeSelector: the ui listbox `Select` (was the old `components/Select`); its four notes are icon + words
  (no projects, unreachable as `role="status"`, where actions run / read-only, Slack).

### Run detail (RunDetailJournal, CompletionBlock, CompletionChecks, PrBadge, PushBadge, checkText)
- "Show older", the completion head, "Open report" and the output-tail toggle are ghost sm `Button`s (were accent
  text links). The head and tail toggle show a chevron and set `aria-expanded`.
- Each check row starts with a status icon (`CHECK_ICON` in checkText.ts) next to its verdict word.
- PR badge and push badge (worktree rows) are ghost sm `Button`s with lucide icons; push shows an arrow icon + count.
  They may be taller than before (their compact rules live in `worktrees.css`, not this Task's file): check.

### Jobs view (JobsView, JobIcons)
- `PageHeader` "Plans" on the list and empty views; one `EmptyState` on the empty view and on the background-service
  screen (was 7 hand-made empties).
- "New job" is the one primary `Button`; "From a source" ghost; "Show archived" a ghost sm `Button` with `aria-pressed`.
- Restart lead agent, details, pause/resume, delete, rename, archive, unarchive and hold are labelled `IconButton`s.
  "Approve & execute" and "Show N more" are `Button`s; the rename box is the ui `Input`.
- JobIcons draws registry icons (status: loading spins, done, error, warning, pending, dashed circle). Outline icons
  replace the filled dots of finished tasks.
- Plain words: coordinator → lead agent, worker → agent, Host → background service in the strings this view shows
  (new `jobs.view.*` keys; `jobs.empty.hint`, `jobs.state.dispatched*` reworded in place).

## Controls that moved or are reached differently
- Jobs: "New job" and "From a source" moved from above the list into the header actions (in the empty view: the
  EmptyState action). "Show archived" moved to the header filters row. The stall line sits under the header.
- Jobs: the card caret is now its own focusable button with `aria-expanded` (clicking the card head still folds it).
  A running row has a new "Open this agent's tab" button (clicking the row still opens it).
- Toolbar ⋮ menu and running list close on Esc, Tab or outside click, no longer on mouse-leave.
- Config pill menu: ↑↓ moves real focus (was a highlight); each row's run button is reached with Tab.
- Run-detail links became ghost buttons in the same places.

## Keyboard map
- **Bottom tab strip:** Tab goes tab, its close button, next tab..., then new terminal, clear (terminal tabs only),
  collapse. Left/Right (wrapping), Home/End move between tabs (new). Enter/Space select a tab; a key on a close button
  does not also select its tab.
- **Rail:** Tab: rerun, stop, scroll to end, clear, find (disabled ones skipped).
- **Find bar:** Tab: text box, previous, next, close. In the box Enter = next, Shift+Enter = previous, Esc closes.
- **Title-bar toolbar:** Tab: config pill, run, stop, ⋮, running badge.
  - Config pill: the `run.selectConfig` shortcut opens it; Enter/Space opens; ↑↓/Home/End over rows and footer;
    Enter/Space picks; Esc closes and refocuses the pill.
  - ⋮: arrows, Home/End, typeahead; Enter/Space pick; Esc or Tab close (Esc refocuses ⋮).
  - Running list: focus goes to the first row; ↑↓/Home/End over jump and stop; Esc closes and refocuses the badge.
- **Run Configurations dialog:** Tab: search, ＋, remove, duplicate, new folder, up, down, tree rows, form.
  - ＋ picker: opens with focus in the search box; typing filters; Enter picks the first match; ↓ to the first row,
    ↑ wraps to the last; ↑↓/Home/End over rows; Enter/Space pick; Esc closes only the picker (not the dialog) and
    refocuses ＋.
  - Folder rename: Enter commits, Esc cancels. "Add option" and references "Add": Menu keys as ⋮.
  - Env table: Tab from the last value adds a row; paste splits into rows.
- **Run detail:** Tab: completion head, per check "Open report" then the tail toggle, then "Show older". Enter/Space.
- **Jobs view:** Tab: New job, From a source, Show archived; per card: caret, source chip, restart lead agent / pause,
  Approve, Details, running rows' open-tab buttons, then the foot: delete, hold, rename, archive. Rename box: Enter
  saves, Esc cancels (an Enter that ends IME composition is ignored).
- Every pre-existing shortcut kept; none removed.

## For promotion (built locally, not in `ui/`)
- Icons used through `<Icon icon=...>` because `ICONS` lacks them: Delete, RotateCw, ChevronsDown, Eraser,
  EllipsisVertical, ArrowUp, GitPullRequestClosed, GitPullRequestDraft, Hand, ServerOff, LockOpen, Pause, CircleDot,
  CircleDashed.
- `Menu` with controlled open state and group headings would let RunConfigMenu and RunTypePicker drop their Popover builds.

## Left for other owners
- `checkText.ts` keeps `GLYPH` (✓ ✗ ○ ! ●) because `plan/PlanGraph.tsx` prints it; PlanGraph should use `CHECK_ICON`.
- `worktrees.css` `.pr-badge`/`.push-badge` padding partly fights the button styles.
- common.ts keys `jobs.hold.*`, `jobs.host.*`, `jobs.stall.*`, `jobs.run.coordinatorRestart*` still say Host / worker /
  coordinator for PlanRow, PlanHeader and PlanList; those screens should switch to the `jobs.view.*` wording.
