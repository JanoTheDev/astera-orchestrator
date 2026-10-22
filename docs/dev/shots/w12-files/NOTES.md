# W12 · Files (All / Changed): what changed, keyboard map

Code-first pass (no screenshots; the final visual check shoots it). Look for the items under "What to look for".

## What changed
- **Right-click menu**: `ContextMenu` (old path) is now ui `Menu` in context mode (`menuPointOf`). Esc closes it and returns focus; arrows, Home/End and typeahead move. Shift+F10 / the ContextMenu key on the tree opens the menu of the selected row (the root's menu when nothing is selected).
- **Icons**: tree chevrons, header buttons, find bar, markdown mode tabs, copy-code, save, folder empty state all go through `Icon`/`ICONS`. `FolderGlyph` is now the registry's `folder` icon.
- **Changed list**: each row is a ghost `Button` (was a clickable `div`, unreachable by keyboard). Empty view is one `EmptyState` with a sentence. "Show more rows" in a diff is a ghost `Button`.
- **Find bar** (Ctrl+F / Ctrl+H): every control is an `IconButton`; toggles carry `aria-pressed`; Esc closes from any control in the bar (before: only from the two fields).
- **Who wrote this**: the hand-built blame popup is a `Modal` (focus trap, Esc, close button, focus returns to the line chip). The toggle is a `Button` and reads "Who wrote each line" (was "Blame").
- **Local History**: rows are buttons (Tab, arrows, Enter/double-click restores), loading is `Skeleton`, empty is `EmptyState` with a hint.
- **Media viewer**: the two actions are `Button`s with icons. **Markdown**: copy-code is an `IconButton`.
- New strings (en/es/ja/ko): `explorer.changed.emptyHint`, `localHistory.emptyHint`; `attribution.blame` reworded.

## Keyboard map
- Tab order in the explorer: header buttons (New file, New folder, Refresh, Collapse all, Close) → All/Changed tabs (arrows move between them) → the tree (one Tab stop).
- Tree: Up/Down/Home/End/PageUp/PageDown move the selection, Shift extends; F2 rename; Delete remove; Ctrl+A/X/C/V/Z; Esc clears a cut/copy; Shift+F10 or ContextMenu key opens the menu. Unchanged.
- Changed view: Tab reaches the first row; Up/Down/Home/End move between rows; Enter/Space open or close that file's diff ("show more rows" is the next Tab stop inside it).
- Find bar: Tab through the buttons in visual order; Enter/Shift+Enter next/previous (replace row: replace/replace all); Esc closes and returns to the editor.
- Dialogs (Local History, Who wrote this line): Modal: Tab trapped, Esc and the X close, focus returns to the opener. Local History list: Up/Down pick, Enter picks, double click restores.
- Menus (right-click, Shift+F10): arrows, Home/End, typeahead, Enter/Space, Esc, Tab closes.

## Moved controls
None moved. The right-click menu item "Local History…" is still the only way to open Local History.

## What to look for
- Changed rows: same height as tree rows, git letter on the right, focus ring visible on Tab.
- Find bar rows are 24px high (were 22).
- The blame details are now a centred dialog instead of a card over the editor corner.

## Left for promotion / known gaps
- `ICONS` lacks: file-plus, collapse-all (`ChevronsDownUp`), `CaseSensitive`, `WholeWord`, `Regex`, `Replace`, `ReplaceAll`, `TextSelect`, `PanelLeft`, `Columns2`. They are passed to `Icon icon={…}` from lucide for now; add them to the registry, then switch.
- `ExplorerLoading` keeps the shared `.loading-spinner` (a row-sized spinner; no ui primitive of that size).
- "Local History" stays an untranslated feature name (existing decision).
