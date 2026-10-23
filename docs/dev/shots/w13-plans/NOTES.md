# W13 Plans view shots

The Plans side bar view after Task T7 "Plans view: one tree from project to Task" (views/PlansView.tsx,
plan/planTree.ts). Taken from `npm run dev` on a temporary profile seeded with `node scripts/shots-seed.mjs` (project
`demo-app`: "Settings page" finished with a failed delivery, "Dark mode toggle" paused with one question). Sizes
1440x900 and 1024x640, themes Night and Day: `<size>-<theme>-<NN>-<what>.png`.

| # | File suffix | What it shows |
|---|---|---|
| 01 | `group-plans` | Group by Plans: the pinned Main plan pane (order, "3 of 7 Tasks done", Open main plan), then the tree Plan › Step › Task. Plan rows: status icon, full name, dim "step 2/3 · 1 of 4 done · 2h ago", the status word, a needs-you badge. Step rows: "Step N" and its count. Task rows: state icon, title, dim account. |
| 02 | `group-status` | Group by Status (the old All tasks board): Needs you / Waiting / Done / Failed, each Task with its plan as the description. |
| 03 | `group-area` | Group by Area (the old By area list): plans under their area ("No area" here: the seed sets none). |
| 04 | `plan-menu` | Right-click on a plan: Open, Open its consoles, Edit plan settings…, Pause, Retry delivery (the failed delivery), Archive, Delete. Night only. |
| 05 | `filter-task` | The filter "theme" matches a Task title: its plan and step open down to it. Night only. |
| 06 | `task-opens-plan-tab` | A click on a Task with no console opens its plan's `view:plan` tab (with the `#task-<id>` anchor waiting for the plan tab). Night only. In the Day shots this tab stays open behind the view. |

At 1024x640 the side bar opens over the editor (DESIGN-W13 §2). The Day shots set the theme through the app's own
`applyTheme` (dev server import), not through Settings.

## Not shown

- The overlap decoration: the seed has no two plans sharing files. planTree.test.ts covers it.
- Steps beyond the seed's waves, a schedule's rounds, archived plans (Show archived in the filter menu).
