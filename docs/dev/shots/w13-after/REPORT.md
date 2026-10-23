# W13 visual check of the workbench

Taken from `npm run dev` (through `astera heavy`) on a temporary profile seeded with `node scripts/shots-seed.mjs`,
driven over CDP (real key and mouse events). Files: `<size>-<theme>-<NN>-<screen>.png`.

- Sizes and themes: 1440x900 and 1024x640, each in Night, Dusk and Day (6 shots per screen 01-14).
  Screens 15 to 19 are 1440x900 Night and Day (15) or Night and Day at 1440x900 plus Night at 1024x640 (16-19), as the Task asked.
- The side bar stays open in every shot. Under 1100px it lies over the editor (see Left).
- Shots 16-19 and 15 need a state the seed cannot reach. They were forced with a temporary, uncommitted harness in
  `App.tsx` (CLI banner, update gate, error) and `PlanPage.tsx` (a live agent); both were reverted before the commit.
  The shell around them is the real one.

## Before the shots: full suite and build

| Check | Result |
|---|---|
| `npx vitest run` (whole repo, 17 939 tests) | 2 failed, 1058 files passed. **1.** `HostRuntimeNotice.test.ts` "shows the error and a reload button": it asserted the error screen does not contain the word `workbench`, but the stack trace in the screen carries the worktree path `.../Visual-check-of-the-workbench-and-README/...`. Not caused by the old-shell removal. Fixed: it asserts the tag `>workbench<`. **2.** `cliHost.integration.test.ts` "runs stop from the CLI and a state-put ...": `CONFLICT: the worker is still starting` under the load of the full run. Run alone: 42/42 pass. A timing flake, not touched. |
| `npm run build` | passes (`electron-vite build`, renderer 6.9 MB, no errors). |
| `npm run typecheck`, `npx vitest run src/renderer src/core/i18n` | run after the fixes, see the end of this file. |

## Screens

| # | Screen | Shots | Keyboard walk | Fixes | Leftovers |
|---|---|---|---|---|---|
| 01 | Agents view (Ctrl+1), Welcome | 6 | Ctrl+1 switches the view; Tab: Open a console, + , Wall button each show a ring | - | - |
| 02 | Plans view (Ctrl+2) | 6 | Ctrl+2; Tab walks Open main plan, Plans, Filter, Group by, Filter, tree, resize handle; arrow keys + Enter in the tree open the plan tab | - | The Filter input shows its focus as a border colour, not a ring (by the input style) |
| 03 | Plan tab (Dark mode toggle, Needs you, Steps, Plan settings) | 6 | Tab: Resume, Open consoles, More, then the answer choices | Reopening a plan whose tab was closed did nothing (see Fixes 5) | - |
| 04 | Explorer view (Ctrl+3) | 6 | Ctrl+3 | - | - |
| 05 | README.md file tab, split | 6 | Ctrl+3, rows open on a double click | Day: editor text was near-invisible (Fixes 2) | - |
| 06 | Source control view (Ctrl+4) | 6 | Ctrl+4 | - | - |
| 07 | History view (Ctrl+5) | 6 | Ctrl+5 | - | - |
| 08 | Run view (Ctrl+6) | 6 | Ctrl+6 | - | - |
| 09 | Settings tab (Ctrl+,) | 6 | Ctrl+, opens it (a real click on the page first: with nothing focused the chord is not delivered by CDP) | Opening Settings after the Wall tab was closed showed the Wall instead (Fixes 3) | - |
| 10 | Bottom panel, Needs you (Ctrl+J) | 6 | Ctrl+J toggles the panel | - | - |
| 11 | New plan tab (Plans view +) | 6 | + button | - | - |
| 12 | New session dialog from Welcome (shell behind) | 6 | Esc closes | The disabled "Chat app notifications" note was unreadable (Fixes 1) | - |
| 13 | Wall tab (Agents view) | 6 | Wall button | The Wall stayed on after its tab was closed (Fixes 3) | The wall is empty here: the seed starts no console |
| 14 | Command box (Ctrl+Shift+P) | 6 | Ctrl+P and Ctrl+Shift+P both open it with focus in the input; Esc closes | - | - |
| 15 | Plan tab of a running plan, working Task, live agent | 2 (1440x900 Night, Day) | - | - | The live state is forced (see top); no real agent ran |
| 16 | CLI-missing banner, in the real shell | 3 | Banner Install and dismiss are reachable by Tab | - | - |
| 17 | New session dialog (with Welcome behind) | 3 | - | Note readable (Fixes 1) | - |
| 18 | Update gate, in the real shell | 3 | Autofocus on the primary button | Day strip checked: not a defect (Checks 2) | - |
| 19 | Error screen with details open | 3 | Reload is autofocused | - | The boundary sits at the root, so the whole window (title bar too) is the error screen. By design. |

Keyboard walk, all screens: Ctrl+1..6 switch the views; Ctrl+B hides and shows the side bar (259px to 0 and back);
Ctrl+J the panel; Ctrl+, Settings; Ctrl+P and Ctrl+Shift+P the command box; Esc closes the box and dialogs; in the Plans
tree Down, Down, Enter opens the plan tab. 14 Tab presses in the Plans view all landed on a visible control; 13 showed a ring.

## Fixes

1. **New session: "(Set a webhook URL in Settings first)" faded three times.** `label.check-small:has(input:disabled)`
   (.55) x `.dlg label.check-small` (.85) x `.check-note` (.6) was about .28. A disabled row now keeps its fade but resets the
   note's opacity and colours it `var(--text-dim)`. File: `src/renderer/src/styles/select.css`. Checked in Night and Day
   (shots 12 and 17).
2. **Day: the file editor was unreadable.** oneDark's light-grey text sat on the light `--md-code-bg`, and the active gutter
   was a dark box. In Day the content is inverted back (`invert(.9) hue-rotate(180deg)`, which keeps the syntax hues) and the
   gutter uses tokens; the extension is not rebuilt, so undo history stays. File: `src/renderer/src/components/fileEditor.css`.
3. **The Wall covered the next tab.** Closing the Wall's own tab left the wall flag on; the next tab opened (Settings, a plan)
   then showed "No consoles yet" with the tab's name in the tab bar. `AgentsPage` skipped the "away" switch when the previous
   tab was null. It now switches on every tab change (EditorArea turns the wall on again for `view:wall`).
   File: `src/renderer/src/components/pages/AgentsPage.tsx`.
4. **Open on an Activity or Needs-you row did not reach a Task in a folded step.** See Checks 1. `goTo` now opens the plan at
   its `task-<id>` section, so PlanPage expands the step and the row, then `revealTask` centres the card.
   File: `src/renderer/src/components/inbox/InboxPage.tsx`.
5. **A plan could not be reopened after its tab was closed** (click the plan or one of its Tasks in the Plans tree right after
   closing the tab: nothing). `useViewTabSync` keyed the open on `openRun.runId`, which had not changed. It now keys on the
   request object, which every open sets anew. File: `src/renderer/src/components/shell/viewTabs.tsx`.
6. **Test:** `HostRuntimeNotice.test.ts` (see the table above).

## Checks the Task asked for

1. **Open on a Needs-you Task row and on an Activity row (running app).**
   - Activity row "Save settings to disk: failed" (Settings page): the plan tab opened on its Steps and the card
     `plan-task-<id>` was centred in the plan area. Plan names show on every Activity row (right column of the
     Activity tab; no shot was taken of it).
   - Activity row "Add the settings form: agent exited": **broken before the fix.** The Task sits in the folded Step 1, its card
     is not drawn, so `revealTask` waited 2 s and gave up (the page scrolled to an unrelated spot). Fixed (Fixes 4): the
     step and row open, the card sits at the centre.
   - Needs you row (seed gate, "Pick the default theme", expanded, **Open plan**): the plan tab opens on the Step 2 card, expanded,
     centred (same fix). The row's main button says Answer for a question; Open appears only for a permission or a wait, which
     goes to the console (`openTargetOf`). The seed has none, so that one was not clicked.
   - The element id in the code is `plan-task-<id>` (`taskAnchorId`), not `task-<id>`; `task-<id>` is the section name.
2. **Update gate, white strip in Day.** Not a defect. In the real shell the strip above the backdrop is the title bar:
   35px (`#f8f8f8` and a 1px border), left uncovered on purpose so the window can be moved (`overlays.css`,
   `UpdateGate.tsx`). On the empty canvas it looked like a stray strip.
3. **Re-click on the same Task in the Plans view.** Click "Wire the toggle into the header" in the tree: the plan tab opens
   and shows the card. Scroll the tab to the bottom (scrollTop 630, card at y=2, off the view). Click the same row again: the
   tab scrolls back to the card (scrollTop 492, card at y=140, inside the 70-878 view). It works. The same path on a second
   open after closing the tab did not work until Fixes 5.
4. **Shots in the real shell:** 16-19 (CLI banner, New session dialog, update gate, error screen).
5. **README shots** (`assets/ui-*.png`, same names), from this workbench, Night unless named:
   `ui-hero-dark` (1920x600, plan tab), `ui-agents-dark` / `ui-agents-light` (Wall, Night / Day), `ui-inbox` (panel, Needs you),
   `ui-start` (New plan tab), `ui-new-flow` (New session dialog), `ui-plan-board` / `ui-plan-light` (plan with a working Task,
   Night / Day; the live state is forced, see top).

## Left

- `src/renderer/src/components/shell/shell.css:228`: under 1100px the side bar lies over the editor, so at 1024x640 the
  left of the Welcome page, the plan tab and the Settings tab is hidden behind it (shots 01-14 at 1024x640). The earlier
  W13 notes say this is the design (Ctrl+B hides it); not changed.
- `ui-agents-*.png` show an empty wall: the seed starts no console, and a console needs a signed-in account. A real wall
  needs a hand-made session.
- Shots 15, 16, 18 and 19 use forced state (harness, reverted).
- `src/cli/cliHost.integration.test.ts` "runs stop from the CLI and a state-put ...": timing flake in the full run, outside
  this Task's paths.

## Final checks (after the fixes)

- `npm run typecheck`: exit 0.
- `npx vitest run src/renderer src/core/i18n`: 184 files, 1548 tests, all pass.
