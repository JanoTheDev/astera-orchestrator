# w12 Plans: what changed

Most of the page was already native (W11: PageHeader, Tabs, Menu, EmptyState, Meter). This pass closes the rest.

## Changes
- `SourceChip` and the Overlap table's plan-name link: raw `<button>` -> ui `Button` (ghost, sm).
- Empty states in `MainPlan` and the Overlap table: hand-made `.modal-hint` line -> ui `EmptyState`.
- Coordinator strip: direct lucide `Users` -> `Icon name="users"`.
- `FailedWaitButtons`: now a `role="group"` named by the "failed Task" hint; props (`title`, `onAct`, `disabled`) unchanged.
- Plain words (en/es/ja/ko, `plans.ts`): "Wave N of M" -> "Step N of M"; "Coordinator · live plans" -> "Lead agents · live plans";
  "N working" -> "N agents working"; "files leased by X" -> "files in use by X".

## Keyboard map
- Tab order: header (From a source, New job, View options) -> By area / Overlap / Main plan tabs (arrows move, one Tab stop)
  -> archived chip -> lead-agent cards (each a button, Enter/Space opens its plan) -> rows top to bottom.
- Per row: rounds toggle (schedules), plan name (Enter opens), source/PR links, failed-wait buttons, Approve,
  restart lead agent, row menu (shown on hover and on focus-within), running agent lines.
- Row menu: Up/Down move, Enter/Space choose, Esc closes and returns focus. Rename field: Enter saves, Esc cancels.
- View options menu: same as the row menu.

## Moved controls
None.

## Not done (report)
- `lucide-react` imports remain in PlanList/PlanRow/MainPlan/PlansPage for glyphs not in the `ICONS` registry
  (ChevronDown/Right, Archive, Hand, RotateCcw, Hourglass...). Promote them to the registry to drop the imports.

## Repair 1
- Plan row, Host gate and stall banner now use plans-area keys saying lead agent, agents, background service, rounds (`pages.plans.restartLead*`, `holdNew`, `releaseNew`, `approveHint`, `sharedFolderHint`, `host.*`, `stall.*`, `roundNumber`, `roundsSoFar`).
