# W12 overlays: command bar, quick switcher and dialogs

Compare with `docs/dev/shots/w12-before/`. Everything below is built from `components/ui` (barrel import);
layout-only styles are in `components/overlays.css` and `command/command.css`.

## What changed

### Command bar (`command/CommandBar.tsx`, `command.css`)
- Now a ui `Modal` (title "Command", close button in the header, backdrop, focus trap, focus goes back to the opener).
  Before: a custom fixed popover with its own `role="dialog"`.
- Order top to bottom: conversation log, the field (search icon, input, mic), search hits under the field. Before the
  hits sat above the field.
- Search hits are the local `PickList` (ui Buttons with roving focus): kind icon + word (Sessions / Plans / Tasks),
  title, where; a "Waiting for you" chip on sessions that wait. A key hint footer (arrows move, Enter open, Esc close)
  shows while searching.
- Links in the log ("Opened ...", session names) are ghost ui Buttons styled as links.
- Plain words: placeholder says "ask the lead agent", "agents" instead of workers; the preview's "Run" button is now
  "Do it"; "Stop starting new agents"; "Opened {plan}: merge from there"; "{plan} has not started yet".
- `barClose.ts` (+ test) removed: the Modal's backdrop and Esc do what it did (click away / Esc closes; the app's confirm
  dialog stacks above, so it never closes the bar under it).

### Quick switcher (`QuickSwitcher.tsx`)
- Now a ui `Modal` titled "Switch tab" (was the legacy `.modal` markup) with a search field and the `PickList`; the
  active tab's title is bold; key hint footer.

### Dialogs
- SourceJobModal: source `<select>` -> ui `Select` (not-ready sources greyed, unpickable); search -> ui `Input`;
  "Coordinator account" -> "Lead agent account", "Auto-fix ... convergence" copy -> "Fix until checks pass".
- NewTaskModal (inline form in the plan detail, not a modal on purpose): all buttons are ui `Button`/`IconButton`
  (close, dependency remove, check move up/down/remove, add-check chips with a plus icon); Title/Instructions are
  `Field`s; dependency picker is ui `Select`; Add is the one primary, Cancel ghost.
- NewSessionDialog: ui `Select`, close icon via `Icon`; the worktree checkbox has a tooltip explaining a worktree.
- RemoteSessionsDialog: running sessions are `Card` rows (Tab, Enter, Up/Down/Home/End); terminal/chat choice is a
  segmented `Tabs`; Cancel ghost.
- ResumeDialog: terminal/chat choice is a segmented `Tabs`; "Host" copy -> "background service"; Cancel ghost.
- CreatePrDialog: "Open it" is a ui Button with an external icon; the branch arrow is an `Icon`; Cancel ghost.
- AddProjectDialog / NewProjectDialog: every string is translated now; Browse is a ui Button with a folder icon;
  fields are `Field`; GitHub repo is a toggle `Field`; visibility is a labelled `Field kind="select"`.
- Overlays.tsx: tab context menu is ui `Menu` context mode (label "Tab actions"); `ToastHost` -> `ToastViewport`.

## Keyboard map

| Overlay | Tab order | Arrows | Esc / Enter |
|---|---|---|---|
| Command bar | header close -> log links / choice buttons -> field -> mic -> highlighted hit | Field: Down enters hits one past the highlighted row, Up enters at the last row. Hits: Up/Down/Home/End move, Up on the first row returns to the field, typing returns to the field | Esc closes (stops the mic). Enter in the field: opens the highlighted hit (search) or sends the sentence; on an empty line runs the shown preview. Enter/Space on a hit opens it |
| Quick switcher | header close -> field -> highlighted row | same as the command bar hits | Esc closes; Enter opens the highlighted tab |
| Tab context menu | - | Up/Down/Home/End, typeahead | Esc closes and returns focus; Enter/Space picks |
| SourceJobModal | close -> source Select -> search -> item rows (and their "Job exists") -> More -> open in browser -> lead agent account -> fix-until-pass -> Cancel -> Make the job | Select: arrows/typeahead | Esc closes the list, then the dialog |
| NewTaskModal | close -> Title -> Instructions -> deps Select -> dep remove -> accounts -> check up/down/remove -> add-check chips -> review -> Cancel -> Add | Selects only | Inline form (Cancel closes) |
| RemoteSessionsDialog | close -> runtime -> session rows -> kind tabs -> account -> folder -> name -> prompt -> Cancel -> Start | rows Up/Down/Home/End; kind tabs Left/Right | Esc closes |
| ResumeDialog | close -> kind tabs -> account -> options -> Cancel -> Confirm | kind tabs Left/Right | Esc closes |
| New/Add project, CreatePr, NewSession, Transcript | visual order, footer last | Selects only | Esc closes (not while busy for project dialogs) |

Every control is a ui primitive with the shared `:focus-visible` ring; pick rows add the ring on top of the accent bar.

## Controls that moved
- Command bar: the X close button moved from the field row to the Modal header. Search hits moved from above the field to
  below it. Shortcuts unchanged (open, voice toggle, Esc).
- Remote and Resume dialogs: the terminal/chat buttons are one segmented control (one Tab stop, arrows switch).
- NewProjectDialog: "Create a GitHub repository" is a toggle; visibility now has a visible label.

## Local primitive for promotion
- `PickList`, `pickListEnter`, `PickKeys` (in `QuickSwitcher.tsx`): a filter field + roving list of ui Buttons.
- `Icon` registry lacks a mic: CommandBar uses `<Icon icon={Mic} />`; add `mic` to `ICONS`.

## Old CSS now dead (not mine to delete)
- `tabs.css`: `.modal.tab-switcher*`, `.tab-switcher-list`, `.tab-switcher-row*`, `.tab-switcher-title`, `.tab-switcher-meta`, `.tab-switcher-empty`.
- `terminal.css`: `.remote-session-list` (+ `li`, `button`, `button:hover`).
- `modal.css`: `.kind-segmented .segmented*` for these dialogs (CreativeHubSettings still uses `.kind-segmented`).
- `projects.css`: `.proj-row`, `.proj-row > input`.
- `worktrees.css`: `.source-job .source-pick select` and its `select:focus-visible` half.
- `runDetail.css`: `.detail-clear` and `.detail-chip.detail-dep button` now override IconButton padding/background
  (keep only `margin-left: auto`); `.detail-check-add` button styling is redundant.
