# W12 shell: title bar, top bar, project switcher, status bar, usage strip

Code-only pass (no screenshots taken here; the final visual-check Task shoots against `docs/dev/shots/w12-before/`).

## What changed

- **Title bar** (`shell/Titlebar.tsx`): the three hand-drawn SVG window buttons are now `IconButton`s with registry icons
  (`remove` = minimize, `stop` = maximize, `copy` = restore, `close` = close). They stay square and flush with the window
  edge (46 x `--topbar-h`); a hairline separates them from the bar's own controls (DESIGN-W11 §8). Their focus ring is
  drawn inside (an outer ring would be cut off at the window edge). Close still asks the Linux quit question
  (`confirmModalWithChoices` + `quitConfirmBody`) when sessions run.
- **Update button**: a `Button` (secondary, sm, `refresh` icon, accent edge) instead of a raw green button. New stays the
  bar's one filled primary. It still calls `onInstall`, i.e. `installUpdate` in `state/useWorkbenchState.ts`
  (`updateInstallPaths.test.ts` green).
- **Top bar** (`shell/TopBar.tsx`): search is a field-shaped ghost `Button` with the `Kbd` chord; the usage meter is a
  ghost `Button` trigger of the accounts `Popover`; every lucide import replaced by `Icon name=…` (More rows: Worktrees
  `repo`, History `history`, Run configs `run`, How it works `info`, Browser `web`). Tabs, More, narrow Pages menu, bell
  placement, New and Settings unchanged.
- **Project switcher** (`shell/ProjectSwitcher.tsx`): the hand-rolled popup (raw `role="menu"`, raw `<button>`s, raw
  `<input>`, `<kbd>`) is rebuilt on the ui `Popover` with `Input`, ghost `Button` rows, `IconButton` row actions
  (`external` = open in new window, `settings`), `Kbd` key hints and an `Icon` check on the current row
  (`aria-current`). The trigger's accessible name now includes the project ("Switch project: gameful").
  `switcherItems` is still the one list of actions; picking a project still goes through `onSelect` →
  `openWorkspaceProject`, so tabs still follow the pick from the first frame (ab0021bf).
- **Status bar** (`shell/StatusBar.tsx`): consoles / working / needs-you are ghost `Button`s (dot as the icon); the two
  background-service restart pills are `Button`s with `loading` while restarting. The "Host" title fallback is a string now.
- **Usage strip** (`usage/UsageStrip.tsx`): `role="group"` so its label is announced.
- **Words** (en/es/ja/ko `shell.ts`): "Host" → "background service" in the status bar, its tooltips, the restart pills
  and the quit dialog hint; "workers" → "agents" in the usage strip. New key `shell.status.hostAbout` explains the
  service (tooltip on the status word).

## Keyboard map

Tab order, left to right:

1. Project switcher button. Enter/Space/click opens the panel; focus goes to its search field.
   - In the panel: type to filter; Enter opens the first match; ArrowDown/ArrowUp move over search field, All
     projects, each project row and its two actions (new window, settings), New project, Add project; Home/End jump
     to first/last row (inside the search field they move the caret). Enter/Space activate the focused row.
   - Esc closes and returns focus to the switcher button; Tab closes and moves on; an outside click closes.
2. Page tabs (Nav): one Tab stop; ArrowLeft/Right move between Home, Plans, Files; Enter/Space open.
3. More ▾ (Menu): Enter/Space/ArrowDown opens; arrows, Home/End, typeahead; Esc closes and refocuses More.
   Below 1100px 2-3 fold into one Pages ▾ menu with the same keys.
4. Search button (opens the command box; also Ctrl+K / the bound chord).
5. Bell (owned by the notifications Task; Popover keys).
6. Usage meter: opens the accounts Popover; arrows move over its rows; Esc closes and refocuses the meter.
7. New (primary). 8. Settings gear.
9. Update button (only when an update is ready).
10. Window buttons (Linux/Windows): Minimize, Maximize/Restore, Close.

Status bar (after the page): consoles, "n working", "n needs you" (opens the bell), then the restart pills when shown.

Shortcuts unchanged (handled outside these files): Ctrl+1…6 pages, Ctrl+Alt+1…9 projects (hinted in the switcher rows),
Ctrl+Shift+K, Ctrl+N, Ctrl+K search.

## Moved controls

None moved. Visual changes to check:
- window buttons use lucide glyphs (Minus / Square / Copy / X) instead of 1px hand-drawn lines; hairline before them;
- the update button is a secondary button with an accent edge, not a solid green one;
- the switcher panel's row actions show on hover/focus as before; "open in new window" is now the external-link glyph;
- status bar: "Background service offline" replaces "Host offline" (longer text).

## For promotion to ui (not done here: ui/ is not this Task's)

- Window-control icon names (`windowMinimize`, `windowMaximize`, `windowRestore`) in `ICONS`; today `remove`/`stop`/`copy`
  stand in.
- A searchable-list Popover (search field + roving rows) — the switcher builds it from `Popover` + `Input`.
