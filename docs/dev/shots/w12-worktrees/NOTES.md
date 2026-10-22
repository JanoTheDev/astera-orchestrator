# w12 Worktrees: what changed

## Changes
- Rows: the whole row is no longer a clickable `div`. The branch/Task/state chips are one `Button` (`.worktree-main`), so a row is reachable and selectable by keyboard. Right-click, Shift+F10 and the ContextMenu key open the row menu.
- Both context menus (row, PR badge) use ui `Menu` in context mode (`menuPointOf`); the old `ContextMenu` import is gone. The PR badge menu also opens under the badge when raised by keyboard.
- Row actions (Start session, Delete) fade in on hover, focus-within or selection (`opacity`, not `visibility`), so they stay in the Tab order.
- Remove and force-remove confirms use the danger variant of the confirm dialog.
- Page header: an info button next to the count explains "worktree" in a tooltip (`worktrees.hint`), also shown when the list is empty.
- Ahead/behind counts carry words in title and aria-label (`worktrees.aheadBehind`).
- Detail: changed-file rows are `Button`s with `aria-expanded`; all icons come from the ui `Icon` registry.
- `WorktreeCreateStatus` Cancel is a ui `Button` (loading while cancelling); the test now looks for `Button`.
- `BranchGlyph` is the registry `branch` icon (same name and `size`, used by NewSessionDialog).
- New strings in en, es, ja, ko: `worktrees.hint`, `helpLabel`, `aheadBehind`, `rowMenu`, `prMenu`.

## Keyboard map
Tab order: header (Clean up, Refresh, View options, Close) -> info button -> search -> Reachable only -> per row: select button, PR/push badge, Start session, Delete -> detail actions (Console, Open console here, Open in Files, More, Delete) -> changed-file rows.
- ArrowUp/Down in the list move between rows' select buttons; Home/End jump to first/last. Enter/Space select.
- Shift+F10 / ContextMenu key on a row: row menu. Menu: arrows, Enter, Esc (focus returns), Tab closes.
- Esc closes View options, More, the context menus, and the confirm dialogs.

## Moved controls
None moved. Row chips and ahead/behind sit inside the select button; PR/push badge and actions stay right of it.

## For promotion to ui
- Registry icons `arrowUp` and `arrowDown` (ahead/behind): `WorktreeDetail.tsx` still imports them from lucide-react.
- A selectable list row primitive (select button plus trailing actions) with arrow-key roving.
- `PrBadge.tsx` and `PushBadge.tsx` (tools area, not mine) still use raw `<button>` and glyph characters.
