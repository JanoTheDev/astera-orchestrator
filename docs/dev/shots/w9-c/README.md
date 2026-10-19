# W9-C: Tasks page, Plans page, plan page

Dev-app screenshots, taken on the dev profile with three sample plans in a scratch project:
`tasks.png`, `plans-area.png`, `plans-overlap.png`, and the plan page's `plan-overview.png`, `plan-waves.png`,
`plan-files.png`, `plan-changes.png`, `plan-journal.png` and `plan-menu.png` (the ⋯ menu).

## Every RunDetail control, before → after

`RunDetail.tsx` moved to `components/pages/PlanPage.tsx` (commit 0b2ca682 is the move with only its import paths
changed). Its modal is gone. Its body is the plan page's body, split into sections.

| RunDetail (modal) | Plan page |
|---|---|
| Title (`jobName`), objective tooltip | Header title. New: rename inline (double-click or ⋯ › Rename) |
| Source chip | Header |
| Workers at once (`jobs-set --concurrency`) | Header, the same input |
| Running count and per-state counts | Header |
| ✕ close, backdrop click | Breadcrumb "Plans ›" (disabled while a form is open, as the ✕ hid) |
| Progress overview (`PlanOverview`) | Overview |
| Graph / Board / Files toggle | Waves (Board / Graph toggle); Files is its own section |
| Usage strip (`UsageStrip`) | Overview |
| Talk to the planner, reject, auto-start notice (`PlanTalk`) | Overview; the header's "Talk to planner" opens it |
| Read-only pairing reason | Every section, above the content |
| Run / Approve (`approvePlan`) | Overview |
| Merge (`run-merge`) | Overview and Changes |
| PR chip (`RunPrChip`) | Overview and Changes |
| + Task (`NewTaskModal`) | Waves |
| Task board: cards, answer boxes, open console | Waves › Board |
| Graph nodes: start, stop, ask, answer, restart, stop auto-fix, ↗ console | Waves › Graph |
| Graph legend, cycle note | Waves › Graph |
| Ask / answer gate forms | Waves (opened from a graph node) |
| Picked Task's filter row (account chip, GitHub links, clear) | Waves while a Task is picked, and Journal |
| Picked Task's completion block | Waves while a Task is picked, and Journal |
| Changed files (`ChangedFilesBlock`) | Changes (the whole plan); the picked Task's in Waves and Journal |
| Older journal, journal busy | Journal |
| Event list (expand, jump to console), hidden count | Journal |
| Files table, open a path in the explorer (`PlanFiles`) | Files |

New on the plan page: Its consoles (opens Agents), Pause/Resume (hold, or a schedule's pause), and the ⋯ menu with
Rename, Start after… (`jobs-set --after`), Restart coordinator, Kill consoles (`runs-stop`), Archive/Unarchive and
Delete. Rename, Start after, hold and archive are offered only for this computer's plans, as the Jobs list does.

## Shortcuts left in the code

- "What happened so far" in Overview: `shortcut: wire W9-I roll-up after merge`.
- A done Task's card opens its plan's Waves until W9-I's summary card has a place of its own.
- "Its consoles" opens Agents unfiltered until W9-H's plan filter lands.
- A paired Runtime's plans stay in the Jobs sidebar until W9-B retires the sidebar.
- The pages are mounted in `App.tsx` over `Content` (`usePlanPages`), until W9-B's page switch mounts them.

## Not done

- Priority has no command to change it after a plan is created (`run-create --priority` only), so the ⋯ menu has no
  priority item.
- Plan areas could not be set for the screenshots: `jobs-set --areas` is for the person or the planner, and these
  were taken from a worker session, so `plans-area.png` shows the "No area" group. The grouping is covered by
  `planBoard.test.ts` (`areaGroupsOf`).
