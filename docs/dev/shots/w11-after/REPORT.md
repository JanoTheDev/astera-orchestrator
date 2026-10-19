# W11 whole-app pass: report

Shot with `npm run shots` (dev app on a copy of the dev profile, project "two", 1 plan done, 2 consoles) into
`docs/dev/shots/w11-after/all/` as `<size>-<theme>-<NN>-<page>.png`, 1440×900 and 1024×640, Night and Day.
Before: `docs/dev/shots/w11-before/` (see its `NOTES.md`). The account email in `assets/` shots is masked as
`you@example.com`; the shots under `docs/dev/shots/` are local and show the real one.
Extra dialog shots: `all/1920x1047-night-add-account.png`, `all/1920x1047-night-source-modal.png`.
Console view in Day: `all/1920x1047-day-console.png`.

## Before / after per page

| Page | Before (w11-before) | After |
|---|---|---|
| Shell / top bar | crowded flat bar, unlabeled switcher, "jip.claude… 16%" truncated, dense mono status bar | switcher button after the mark, hairline, field-shaped search with Kbd caps (label truncates, Kbd clear of the usage label at 1024), usage meter, one filled New, word status bar. Switcher menu says "New project" (no `+`). |
| Agents | three chip styles, one 700px card in a corner, clipped status line, no plan grouping | page header with count, state segmented + plan chips, plan groups (name, progress bar, Open plan), full-width tiles, empty state with New console, "Nothing matches / Clear filters". Chip count gap fixed (`Hello one, Hello two 2/2`). |
| Start | flat form, native select, tiny primary | project picker, Build / Audit / From issues segmented, options panel, sticky footer with the primary. |
| Tasks | five empty columns saying the same | empty state with New task; with data: Planning section above the board, then five columns. |
| Plans | narrow left block, orphaned toolbar, no empty state | header with actions, By area / Overlap, Coordinator strip, rows. At 1024 the list now starts at the same 24px edge as Tasks/Worktrees (it was centred at 960px, 56px in). Archived-only project shows the empty state instead of a blank page. |
| Plan | old header with raw input | PageHeader, tabs, Waves board; "Workers at once" is the `Input` primitive. |
| Inbox | stacked empty boxes | "Nothing needs you" is one line; Handled for you fills the page and scrolls inside itself, also at ≤1100px wide (1024×640). |
| Worktrees, Files, Settings | see before notes | Settings icon nav + cards, Worktrees list/detail, Files explorer; unchanged in this pass. |
| New menu, switcher, accounts | plain lists | cards, search + checks, popover with usage. |

## Owner flows, walked by hand in the app

- Switcher: picked "two", opened a console, reloaded: switcher still "two", console still there. PASS.
- Start with the project picker: New → Run as written → Start opens with the Project select (all 11 projects); typed two `##` sections, "Start 2 consoles" created a plan; planner and coordinator ran, 2 haiku Tasks done. PASS.
- Planning plan in the Tasks page: the "Planning" section showed it with "Planner console" while it was written. PASS.
- Plans coordinator strip: "Coordinator · live plans" card with Planning…, wave, workers, waits. PASS.
- Start after lists only live plans: the Start select offered only "Right away" with no live plan and while the plan was planned-but-unapproved (not a live state); covered by `startLogic.test.ts` (`livePlans`). I did not get a running plan to appear in the list: Tasks finished in under a minute. PARTLY verified by hand.

## Wave-3 review leftovers

- Shell re-shoot: done, `shell/` refreshed. Top bar checked at 1440 and 1024. Fixed.
- Agents wall: plan group (progress bar, Open plan) and a Done count are in `all/*-01-agents.png` in Day and Night, console view in Day. **Left:** a finished summary card and a Task-bearing tile. Worker consoles close when a plan ends ("Close an ended plan's tabs"), and the 2 Tasks finished in under a minute, so there was never a live Task tile to shoot. Covered by `wallModel.test.ts`. Tile text floor: `TILE_MIN_READABLE_PX = 9.5` in `lib/terminalScale.ts` (`tileScale`), tested; at the floor the right columns clip, newest rows stay visible. Fixed.
- Plan page header: kept "Workers at once" (the Coordinator/View options do not own it) and restyled it with `ui/Input`. Fixed. Paused wording: `jobs.hold.held` is now "Plan paused" like `plan.reason.paused` in en and ko (ja/es fall back to en). Fixed.
- NewSessionDialog: the two unattended-policy buttons are `Tabs variant="segmented"` (the app has no separate Toggle/Segmented component). Fixed. Not shot: that control only shows for chat sessions.
- Start mode labels: Build / Audit / From issues in en/ko/ja/es. Fixed. **Note:** the New menu entries (`new.*`) still read "Plan it for me / Run as written", and the hint under "From issues" still says "Each .md file or ## section becomes one task". Left: renaming those belongs to the owner's wording decision.
- Inbox empty state: fixed (see table).
- Dialogs: add-account and "Make a job from a source" shot and look right, except the source select is a native control narrower than the account picker below it (deliberate: a source that is not ready is a greyed option). **Left:** slot-remove (needs two accounts; the profile has one) and source-exists (needs a source with items; the repo has no remote).

## Left / known

- `1 plans`, `1 consoles` plurals (`pages.plans.count`, wall count) have no singular form.
- Single console/coordinator tiles are full width with a large empty terminal body; terminal link colours in Day are low contrast (the terminal theme, not a page).
- The plan page stays a 960px centred column while the other pages are full width.
- `New menu` titles differ from Start's Build/Audit/From issues (see above).
- `scripts/shoot.mjs`: the plan step now clicks `.plans-row__name` and the loop goes back from a plan page, so the Plan page is shot (it was skipped, and left open it blocked `Ctrl+digit` for later pages).

## Checks

- `npm run typecheck`: pass.
- `astera heavy -- npx vitest run --maxWorkers=2`: 16313 passed, 0 failed. Four host tests (`src/host/activity.test.ts`, `src/host/orchPlanner.test.ts`) had failed on HEAD since `validatePlan` began requiring `--affected-paths` on every Task; their seeded Tasks now carry `affectedPaths: ['a.txt']`.
- `astera heavy -- npm run build`: pass.
