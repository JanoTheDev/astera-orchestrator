# W11 after: Tasks, Plans, Plan (T14)

Shot with `npm run shots` (03-tasks, 04-plans) and a CDP capture of the Plan page (05-plan, 05-plan-waves: the
script's "plan" step clicks the first button in main, which is not a plan) on a copy of the dev profile with three
held fixture plans in project "two": "Redesign the task board" (3 waves, 2 of 5 done), "Board data refresh"
(overlaps it on `src/board.ts`) and "Plan page split" (queued after the first). All three carry `dispatchHold`, so no
worker ever started. `before/` holds the same pages from the code before this Task.

## Plan page before (it had no shot in w11-before)
- No wave in the header or Overview: "40% done" only; which wave is open and what opens the next one was only
  visible on the Waves tab as a "NOW" tag.
- Three tab styles on one page: the section switch as a boxed segmented control, Graph/Board as outlined pills,
  and the top bar's underline.
- The status chip says "Not launching" while every card under it says "Plan paused" for the same hold.
- Header actions are three different button styles ("Its consoles", "Resume", a bare ellipsis); "Workers at once"
  is a native number box.
- Overview is nearly empty (progress line, a usage line, an empty "What happened so far").

## After
- Tasks: PageHeader with open count and the one primary "New task"; plan scope as one segmented control with each
  plan's done/total; Planning section first; columns are panel surfaces with counts, scroll sideways under 1100px;
  one page-level EmptyState. A waiting card names why with a chip: files leased by another plan, queued after a
  plan, the wave that is open, same files, usage limit or worker cap (the fixture's hold shows the plain line only).
- Plans: native page (no JobsView): PageHeader with "New job" primary, "From a source" ghost and a View options
  menu (delivery choice moved there); By area / Overlap with a one-line tooltip; "Show archived" chip. The
  Coordinator strip shows every live plan side by side: state, wave n of m, workers, and what it waits on (lease,
  queued after, overlap needing a decision). Rows: status chip, wave, progress meter, last activity, actions in an
  overflow menu.
- Plan: back button, title, state, "Wave n of m" and counts in the header; section switch as underline tabs; the
  Overview and Waves tab say what opens the next wave ("Wave 3 opens when 2 Tasks finish").

## Left
- "Plan paused" (plan.reason.paused) is still the card word for a plan's hold while the header says "Not launching".
- The Plan header's "Workers at once" box is still the old input.
