# W17 plan tab: fluid, fills its tab

Shot on a seeded temporary profile (`scripts/shots-seed.mjs`), plan "Dark mode toggle", over CDP at 1440x900,
1024x640 and 420x800 (side bar closed, so the tab is about 370px wide), Night and Day. `before-*` is main at
f56b30eb; `after-*` is this branch. `after-420-*` and `after-graph-*` show the narrow tab scrolled to the steps and
settings, and the graph (advanced mode).

## Before

- The page stopped at 960px and centred itself: at 1440 the tab is 1122px wide, so 160px of empty gutter.
- At 420 the tab scrolled sideways (content 413px in a 362px tab). The step lists sized to their rows: the old board
  rule `.plan-board { align-items: start }` still applied to the steps column.
- At 420 the header actions took the row and cut the plan name to "Dark mo…".
- Breakpoints asked the window (`@media`), not the tab, so a narrow split in a wide window got the wide layout.

## After

- The tab root (`.plan-pages`) is the size container `plan-tab`. Every breakpoint is `@container plan-tab`; no
  `@media` is left in planPage.css, plan.css, planBoard.css or plans.css. Narrow means under 560px.
- No width cap: the page fills the group (1082px of 1122 at 1440). Prose caps at 80ch: the goal, what was decided,
  Needs you and talk messages.
- Steps are a fluid grid, `repeat(auto-fill, minmax(min(100%, 560px), 1fr))`: one list up to about 1150px, then
  steps side by side. When narrow, a step's head sticks while its rows scroll. A Task row puts the name on the first
  line and the status line with the meta on the second.
- Header: narrow folds Pause, Open consoles and the ⋯ menu into one ⋯ `Toolbar`. Start and Merge stay. The name
  reads in full at 420. The progress meter is `clamp(80px, 20cqi, 320px)` instead of 120px.
- Plan settings: as many columns of rows as fit (two at 1440). The control column is `minmax(120px, 200px)`.
  When narrow, the control sits under its title.
- Graph: zooms to the box down to 0.7 (`graphZoomOf`, tested), then scrolls. At 420 it draws at 0.81 with no
  sideways scroll. It never grows past its laid-out size.
- Fixed widths became `cqi` clamps: step meter, row account, file Task chips. Coordinator cards grow from 240px.
  The Main plan list lost its 960px cap.
- Removed the dead CSS of the old board and breadcrumb (`.plan-head`, `.plan-overview`, `.plan-progress*`,
  `.plan-counts`, `.plan-view-toggle`, `.plan-col*`, `.plan-crumb*`). Nothing renders these classes.

Measured on every shot: no sideways scroll in the tab and no clipped text (leaf elements wider than their box
without an ellipsis): 0 at all three widths, in both themes.
