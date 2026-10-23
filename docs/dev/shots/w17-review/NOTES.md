# W17 review: change map, then code, with per-hunk actions

Shot on a seeded temporary profile (`scripts/shots-seed.mjs`). The seeded worktree `shots/settings-page` got one
more commit on top: `src/settings/store.ts`, `src/settings/validate.ts` and `src/ui/SettingsPanel.ts` (new, importing
each other and `src/settings.js`), and a change to `src/index.js` (`greet` modified, `farewell` added). Shots are over
CDP at 1440x900 and 1024x640 (side bar closed: under 1100px it is an overlay) and at 420x800 (side bar closed, so the
tab is about 370px wide, the narrow split). Each size is shot in Night and Day.

| File | What it shows |
|---|---|
| `<w>-<theme>-1-map.png` | The worktree tab scrolled to Review: the summary strip, then the change map, then the code. |
| `<w>-<theme>-2-code.png` | After a click on the `loadSettings` symbol in the map: the code panel has scrolled to its hunk, which is current (blue border). The hunk's action bar shows on hover/focus. |
| `<w>-<theme>-3-ask.png` | `a` on the current hunk opens Ask AI to fix with a note. It says where the prompt goes: a new agent session in the worktree, on the Auto account. For a plan Task with a running worker, it goes to that worker. |
| `1440-<theme>-4-hover.png` | Hovering `store.ts` in the map. Its import edges are drawn thicker. Files not linked to it fade. |
| `1440-<theme>-5-list.png` | The list view of the same map. This is the graph's accessible equivalent. It is also what a narrow tab and a change of more than 40 files get. |

## What the design does

- **Flat, DESIGN-W13**:
  - Areas are 1px-ruled frames on `--panel`. Files are boxes on `--bg`. No shadows, except on the action popover.
  - Status always has a second cue. Symbols carry a glyph: plus for added, pencil for modified, minus for removed. Files carry the git letter (A, M, D, R).
  - New import edges are dashed and drawn in `--link`. Existing ones are solid and faint.
- **Fluid**:
  - `.rv` is its own size container.
  - From 1180px of tab width, the map sits in a sticky column beside the code. Below that, the map is above the code.
  - Under 640px the graph is swapped for the list, and the Map/List switch hides.
  - The graph packs its areas into as many 236px columns as fit. It is laid out by `layoutAreas` in `flowLayout.ts`, which places each area in the shortest column.
- **Code**:
  - The code is grouped by file, then by changed symbol. Hunks that no symbol claims sit under "Other changes".
  - File headers are sticky. A file's "Viewed" box folds it.
  - The mark is kept per worktree in localStorage, and it lapses when the file's +/- change.
- **Keys**: `j`/`k` move between hunks, `v` marks the file viewed, and `a`/`e`/`r` run Ask AI, Edit and Request changes. Hunks and every action are reachable by Tab, with a visible focus ring.

## Not shown

- Request changes appears only on a plan Task's worktree. The seeded worktree belongs to no plan.
- The plan's Changes tab shows the same view for the plan's own folder when this computer has it registered. The seeded plans have no Run folder.
