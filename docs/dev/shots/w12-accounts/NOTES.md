# Accounts and usage (W12)

## What changed
- All raw `<button>`, `<input>`, hand-drawn SVG icons and glyphs replaced by ui primitives (`Button`, `IconButton`, `Field`, `Input`, `Tabs`, `Chip`, `EmptyState`, `Icon`). `AccountSelect` imports `Select` from `./ui` (old `./Select` path gone).
- Usage meters: past 75% a warning icon (named "Close to the limit") sits beside the percent, so colour is not the only cue.
- Empty accounts list: one `EmptyState` (popover has a primary "Add account"; settings points to the top bar).
- Add / import: provider choice is a segmented `Tabs`; label is a `Field`. Detected-accounts list uses `Input` + `Chip` (signed in / not signed in, with a dot and a word).
- Sign-in dialog: "Open in browser" (primary) and "Copy" are `Button`s with icons; code box is a `Field` with a "Send code" button.
- Remove dialog confirm is the `danger` variant. Settings usage-guard numbers are `Field kind="number"` with their hint.
- Hint no longer uses the glyph; it names the "Import settings" button.

## Moved / new controls
- Settings row, former `⤓` icon button: now a text button "Import settings" (same action, same visibility rule).
- Former `✕` remove in settings: trash icon button "Unregister" (same action).
- New: pencil "Rename" button in every row (rename was double-click only, not keyboard reachable). Double-click still works.
- Popover remove/rename buttons are faint until the row is hovered or has focus (focus-within shows them).

## Keyboard map
- Popover (top bar): Tab order = Add account, Import, Detect, then per row: row (when it has usage; Enter/Space opens its detail), Rename, Sign in (if signed out), Use for this tab, Unregister. Esc closes the popover (ui Popover).
- Settings: per row: row (usage detail), Rename, Import settings, Unregister; then usage-guard number fields and per-account session caps.
- Dialogs (add, import, detect, sign in, unregister, import settings): `Modal` focus trap, Esc closes, Enter submits forms. Add/Import provider choice: arrows move between Claude and Codex.
- Rename field: Enter saves, Esc cancels.
- Account picker (`Select`): Enter/Space/arrows open, arrows/Home/End/typeahead move, Esc closes.
