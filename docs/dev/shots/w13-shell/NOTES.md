# W13 shell shots

The DESIGN-W13 workbench after the Task "Workbench shell: activity bar, side bar, editor, panel, status bar".
Taken from `npm run dev` on a temporary profile seeded with `node scripts/shots-seed.mjs` (project `demo-app`, two
plans, one question waiting). Sizes 1440x900 and 1024x640, themes Night and Day: `<size>-<theme>-<NN>-<what>.png`.
The side bar views are still adapters over the old pages; their own Tasks redesign them.

| # | File suffix | What it shows |
|---|---|---|
| 01 | `agents-welcome` | Launch state: title bar with the command center (project `demo-app` + "Search or run a command" + Ctrl+Shift+P), activity bar with the Agents badge (1 needs you), the Agents view (Needs you / Working / Finished panes, Open a console + Show the wall in the view title), Welcome in the empty editor area (New plan, Open a console, recent plans, keys), status bar (project + branch `main`, "1 needs you", Connected, bell). |
| 02 | `plans-plan-tab-needs-panel` | Plans view (Ctrl+2) with a plan opened from Welcome as a `view:plan` editor tab; the status bar's "1 needs you" opened the bottom panel on Needs you (the Inbox). |
| 03 | `settings-tab` | Ctrl+, opens Settings as a `view:settings` tab next to the plan tab; panel closed with Ctrl+J. |
| 04 | `explorer-file-tab` | Explorer view (Ctrl+3). In 1440x900 Night a README.md file tab is open (split Markdown editor); in the other three runs the scripted single click did not open the file, so the editor still shows the Settings tab. |
| 05 | `run-view-terminal-panel` | Run view (Ctrl+6) with the seeded `bash` configuration; its "New terminal" opened the panel's Terminal tab with a live shell (xterm). |
| 06 | `scm-view` | Source Control view (Ctrl+4): the Worktrees list adapter. |
| 07 | `history-view` | History view (Ctrl+5): Sessions (HistoryBrowser) and Work records (How it works) panes. |

At 1024x640 (under 1100px) the side bar opens over the editor instead of pushing it (DESIGN-W13 §2).

## Checked by hand in the same run

- Ctrl+B and Ctrl+J toggle the side bar and the panel; Ctrl+1…6 switch activities; Ctrl+, opens Settings; Ctrl+Shift+P
  opens the command box; Ctrl+P opens the quick tab switcher.
- Clicking the active activity collapses the side bar; side bar width (sash, arrow keys), side bar visibility, panel
  visibility and activity survive a reload.
- Opening the same plan or Settings again focuses the existing tab. New plan (Plans view +) opens the `view:start` tab.
- Show the wall (Agents view title) opens `view:wall`: the wall fills the editor area.
- The panel's xterm keeps the same DOM node across Ctrl+1…6 (no remount).
- Status bar: project item opens the project switcher, "1 needs you" the panel's Needs you tab, the bell its popover.
  Accounts (activity bar) opens the account popover; Manage opens Settings / Keyboard shortcuts / Help / Check for
  updates.

## Not shown

- A live agent console: the seed starts no agent, and none was started for the shots.
