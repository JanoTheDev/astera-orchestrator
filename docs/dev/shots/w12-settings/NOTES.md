# W12 Settings: page shell, General, Agents, Notifications, Advanced

Before: `docs/dev/shots/w12-before/settings/`. Code only; the final visual-check Task shoots the after state.

## What changed

Page shell (`settings/SettingsPage.tsx`, `SettingRow.tsx`, `settingsPage.css`)
- Side nav groups are ghost ui `Button`s (were raw `<button>`), left-aligned, full width, same active marker.
- Nav and group icons go through ui `Icon` (`filter`, `users`, `notifications`; Bot, FolderKanban, Plug, Wrench by `icon=`
  until they are in the registry).
- Search field is ui `Input` inside the same bordered box; the inner ring is turned off so only the box shows focus.
- "No setting matches" is now one `EmptyState` with a headline ("No settings found") and the sentence.
- New `arrowFocus(selector, orientation)` in `SettingRow.tsx`: arrow-key focus for the nav and the card choices.

General
- Language and "New sessions open as" are ui `Select` in the list (`items`) form (were the native `<option>` form).
- Advanced mode is ui `Switch`. Search icon in the shortcut table is ui `Icon`.
- Theme cards are ui `Card onClick` (were raw `<button>`); the check on the picked card is `Icon name="check"`.
- Shortcut table: edit/reset icons through ui `Icon` (reset still RotateCcw by `icon=`).
- Terminal font pickers import ui `Select` from the barrel (old `components/Select` path dropped).

Agents
- Every on/off is ui `Switch` (permission mode, agent browser, agent app, stall watch, start at login, auto answer,
  plan continuity). Number and text fields (max agents, fresh lead agent, role models, voice paths) are ui `Input`.
- Resume strategy cards are ui `Card onClick`.

Notifications
- Desktop notice toggles, chime and tab summaries are ui `Switch`; the summary interval is ui `Input`.

Advanced
- Work unit tracking is ui `Switch`. Worktree "Change…" is a small ui `Button` with a folder icon.
- The worktree label has an info icon with a `Tooltip` that says what a worktree is (focusable, Tab reaches it).
- Description generator: model field ui `Input`, "Refresh" a small ghost `Button` with the refresh icon; ui `Select`
  from the barrel.
- History (hidden projects): search is ui `Input`; "Delete selected" is a danger `Button` (spinner while deleting);
  "Unhide" a ghost `Button`; the page arrows ‹ › are `IconButton`s with chevron icons and names. The row and
  select-all checkboxes stay native checkboxes (applied later with the Delete button, per ui README).
- Update mode is ui `Select` in list form, in a `div` row (a `label` row re-opened the listbox on close).

Words (en, es, ja, ko in `settings.ts`)
- Coordinator → lead agent (explained once in the fresh lead agent hint), Worker → agent, Host → background service,
  wave → step, Job → plan, "question gate" → "plan question waiting for you". Keys kept; values reworded.
- New keys: `settings.worktree.tooltip`, `settings.search.emptyTitle`. es/ja got the reworded keys they lacked
  (role models, max agents, background service notes, chime, tab summaries).
- Search: "worker" no longer finds the agent limit row (its label is "Max agents across all plans"); "agents" does.

## Keyboard map

- Page opens with focus on the page; Esc clears a non-empty search, else closes Settings and focus returns to the opener.
  A control that handles Esc itself (open Select, shortcut search with text, shortcut capture) keeps it.
- Tab order: Back → settings search → nav groups (each a Tab stop, top to bottom) → the shown group's rows top to
  bottom, each row's control after its label → "Show/Hide advanced settings".
- Nav: Up/Down move between groups (wrap), Home/End jump; Enter/Space opens the group.
- Theme cards and resume strategy cards: Left/Right (and Up/Down) move between cards, Home/End jump; Enter/Space picks.
- Select: Enter/Space/Down opens, arrows/Home/End/typeahead move, Enter picks, Esc closes the list only.
- Switch: Space toggles. Shortcut table: edit and reset buttons show on row hover or focus-within, Tab reaches them.
- History: search → select all → Delete selected → each row (checkbox, Unhide) → previous/next page.
- Every control uses the shared `--focus-ring` on `:focus-visible` (nav buttons, cards, inputs, worktree info icon).

## Moved controls

None moved between groups. Changed in place only: the worktree row gained an info icon beside its label; the history
paging arrows are icon buttons in the same spot; the generator's Refresh stays under the model rows.

## For promotion to ui (not built in ui/)

- Icon registry names wanted: `bot`, `kanban` (FolderKanban), `plug`, `wrench`, `reset` (RotateCcw), `chevronLeft`.
- `arrowFocus` (roving focus over any selector) could live in `ui/logic.ts` beside `nextFocusIndex`.
- A ui `Checkbox` (the History list still uses native checkboxes).
