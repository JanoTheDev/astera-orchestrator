# W12 · Agents wall and full console — notes for the visual check

Compare against `docs/dev/shots/w12-before/agents/`. These were style and markup changes only. PTY, xterm options, terminal input and scroll, and session lifecycle code were not touched.

## What changed

### Wall (`pages/AgentsPage.tsx`, `wall/Wall.tsx`)
- Every icon now comes from the ui `Icon` registry. There are no direct lucide imports. The state chip icons are now: permission `lock`, question/needs-you `warning`, working `activity`, done `done`, idle `pending`. The chip icon grew from 12 px to 14 px, the registry's dense size.
- The tile's overflow menu now uses these icons: `external` (Open in new window), `hide` (Hide tab), and `stop` (End session). The old icon for End session was Power.
- The plan picker shows when a scope has more than 6 plans. It is now the ui listbox `Select` (`items` form). Each project heads one group, each row shows the plan's count on its right edge, and "All plans" and "No plan" are the first and last rows.
- The empty state's icon is `ICONS.terminal`. "New console" in the header and in the empty state uses the `add` icon.
- Plain words: role sections now read "Lead agents" (was Coordinators) and "Agents" (was Workers). The card meta roles read "lead agent" and "agent". The "gate" activity now reads "Waiting for your decision". The owner-hold line reads "the lead agent's messages…". In summary facts, "coordinator / owner" became "lead agent / you". The worker summary role reads "Agent". All four locales are updated.

### Full console (`wall/FullConsole.tsx`, `wall/SummaryCard.tsx`, `wall/PlanSummaryRollup.tsx`)
- The worktree link in the details panel is a ghost `Button` with the `branch` icon. A `Tooltip` explains what a worktree is (new key `wall.details.worktreeHint`) and shows the folder path. That path used to be only a `title`.
- The plan's task rows in the details panel are ghost `Button`s.
- The details toggle announces its shortcut (`aria-keyshortcuts="Control+."`).
- In the summary card, the title and the pull-request link are ghost `Button`s, and the PR link gained the `external` icon.
- `wall.css` has new `.ui-btn.branch-link`, `.ui-btn.summary-card__*` and `.ui-btn.wall-details__task` rules. The plain `.branch-link` rules that TaskBoard and HistoryBrowser use are unchanged.

### Console area (`shell/Content.tsx`, `TerminalView.tsx`, `SessionStateBanners.tsx`, `terminal.css`)
- The "Start a new session" placeholder is a primary `Button` with the `add` icon.
- The exit overlay's Restart is a primary `Button` with the `refresh` icon. The old `.exit-overlay button` CSS was removed.
- The scheduler banner's "Turn off" is a small ghost `Button`. The banner stays 25 px high, which `BANNER_ROW_PX` relies on.

### Tab strip (`WorkbenchTabs.tsx`, `RunTabStrip.tsx`, `tabs.css`)
- The tab close, `+` and overflow controls are `IconButton`s. The overflow list (every tab, then "Recently closed") is now the ui `Menu` in context mode, opened under the trigger. The old scrim and list CSS are gone.
- The strip is a real `tablist` (new key `tabs.strip.label`). Each tab is a `role="tab"` with a roving tabindex.
- The focused-pane underline moved from an inline box-shadow to `.tab.marked`, so the focus ring is no longer hidden on the active tab.
- Tab kind icons come from `Icon` at 14 px. The terminal kind uses the registry's `SquareTerminal`, which looks slightly different from the old `Terminal` glyph.
- The run tab strip's preview and close buttons are `IconButton`s (16 px to fit the 22 px tab). Arrow keys were added.
- `run.panel.empty` no longer shows the "▶" glyph. It now reads "Press Run in the toolbar…".

### Chat panes (`conversation/`)
- Every control is a house `Button`: pending stop, exited detail/restart/terminal, request-card choices, question-card submit/terminal, remote "Load earlier"/"Stop", and sent-file links. Only one control per view is filled primary.
- The model and permission-mode menus use the ui `Menu` in context mode. The current choice is a `checked` row instead of a "✓ " text prefix.
- The completion list (slash commands and @files) is a labelled group of `Button` rows. Focus stays in the composer. The active row is `aria-current` and is announced through a polite live region (new key `conversation.completion.label`).
- Question options are labels wrapping visually hidden native radios or checkboxes, each group named by its question.
- The pulsing "●" in the pending banner is a CSS dot.

## Keyboard map

| Where | Tab order | Keys |
|---|---|---|
| Wall header | New console → state segmented tabs → plan chips (or the plan Select) → All projects | Segmented tabs: Left/Right. Select: Enter/Space/Down opens; arrows, Home/End and typeahead move; Enter picks; Esc closes the list |
| Wall body | Per plan group: Open plan → each tile card → that tile's "More" menu → Done cards | Enter/Space opens a tile full size. In the More menu: arrows/Home/End, Enter picks, Esc closes and refocuses the trigger |
| Full console header | Back to all consoles → details toggle | Ctrl+. folds the details panel |
| Console strip | One tab stop | Left/Right/Home/End move, Enter/Space opens that console |
| Terminal | The PTY gets every key (unchanged). Exit overlay: Restart. Scheduler banner: Turn off | — |
| Details panel | Worktree link (tooltip shows on focus) → each task row | Enter opens the worktree / the task's console (or its plan) |
| Pane tab strip | Active tab → each tab's close → `+` → overflow | On a tab: Left/Right/Home/End move (wrap), Enter/Space select, Shift+F10 or the ContextMenu key opens the tab menu. Overflow menu: arrows/Home/End/typeahead, Enter, Esc closes and refocuses, Tab closes. Ctrl+Shift+T and the other global shortcuts are unchanged |
| Run tab strip | Selected run tab → its preview → its close | Left/Right/Home/End move, Enter/Space select |
| Chat composer | Composer → stop (while running) → model → mode | Enter sends, Esc stops the turn. Completion list: Up/Down move, Enter/Tab take, Esc closes, and focus never leaves the composer. Model/mode menus: arrows, Enter/Space, Esc closes and refocuses |
| Question card | Each question once (radios: arrows pick, checkboxes: Space) → Other field → terminal → Send answers | — |
| Tool rows | Group trigger (Enter/Space toggles) → sent-file buttons | — |

Every control uses the ui focus ring (`:focus-visible`). On the tab-strip buttons the ring is drawn inset, because `.tabs` scrolls and would clip an outside ring.

## Moved or changed controls (nothing removed)
- The tab overflow list is now a ui Menu, opened left-aligned under the overflow button. It flips left at the window edge. An outside click now closes it and also reaches what was clicked; the old scrim swallowed that click.
- Pane tabs went from no Tab stops to one roving Tab stop. Run tabs went from all being Tab stops to one roving stop.
- The model and mode menus are the ui Menu at the same position. They still flip upward when there is no room below.
- The worktree folder path moved from the hover `title` into the worktree link's tooltip.

## For promotion into `components/ui` (built locally, needs an owner change)
- ICONS has no entry for `Keyboard`, `PanelRightOpen`/`PanelRightClose`, `CheckSquare`/`Square` (as a checkbox, distinct from `stop`), `Film`, `Image`, `Monitor` or `Repeat`. These are still imported from lucide in `FullConsole.tsx` and `WorkbenchTabs.tsx` and drawn through `<Icon icon={…}>`.
- A `Combobox` primitive for the chat completion list (focus stays in the textarea). Today `CompletionMenu.tsx` is a local stand-in.
- A toggle style for the mode button. It keeps the global `.plan-pill[aria-pressed]` look from `panes.css`.
- `ToolRow` still uses the vendored Radix `ui/collapsible` (`asChild` around the house Button). Its scroll lock lives in Radix's `onOpenChange`.

## Look for in the after shots
- The summary-card title and PR link, the worktree link, and the details task rows. They should read as text links or rows, not as boxed buttons.
- The 16 px run-tab buttons, the `+` and overflow segments in the tab bar, and the inset focus rings.
- Chat sent-file links and the model readout may look dimmer or taller, because a ghost Button sets its own colour and height.
