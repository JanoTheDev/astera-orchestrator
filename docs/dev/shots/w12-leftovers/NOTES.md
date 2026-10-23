# W12 leftovers: kanban, New task, plan name, stale project, and the three unshot surfaces

Shots: `before/` and `after/` here. Names are `<size>-<theme>-<surface>.png`. Seeded profile (`scripts/shots-seed.mjs`),
dev app on a temp profile, CDP driver. Day and night, 1440x900 and 1024x640.

## Fixed
1. **Tasks board at 1024x640** (`plan.css`): five columns are `minmax(0, 1fr)` and shrink to fit; only a window under 900px
   scrolls the board itself. Measured: before the board was 1148px wide in a 976px box at 1024 (sideways scroll, Done cut);
   after 976/976, all five columns, page scrollWidth = 1024. Shots: `*-tasks.png`.
2. **New task form** (`NewTaskModal.tsx`, `PlanWaves.tsx`, `PlanJournal.tsx`, `usePlanPage.ts`): a ui `Modal` over the plan
   page instead of the lower half of the page. The step board keeps its full height behind it (the lower pane no longer
   opens for this form). Every field is kept: title, instructions, depends on, accounts, completion checks, review.
   At 640px high all fields fit in the dialog; the body scrolls when the account list grows. Shots: `*-new-task.png`.
   (The spec names `plan/NewTaskModal.tsx`; the file is `components/NewTaskModal.tsx`.)
3. **Plan name in the Plans row** (`plans.css`, `PlanRow.tsx`): the name no longer shrinks (still capped at 40%); the
   "Not delivered: ..." text takes the squeeze and ends in an ellipsis, with the full text in its tooltip. The seeded reason is
   short enough to fit, so the shot (`*-plans-long-chip.png`) pushes a long reason into the row by DOM edit: before the row read
   "Settin..." and "Faile"; after "Settings page" and "Failed".
4. **Stale project** (`useJobs.ts`): the selected project is re-read with `files.list` when it is picked and when the window
   regains focus; ENOENT drops it (back to All projects). Any other error keeps it. Test: `state/useJobs.scope.test.ts`.
5. **Found while walking, fixed:**
   - `ui/Modal.tsx`: first focus went to the header Close button in every modal. `.ui-modal__body ${FOCUSABLE}` scoped only
     the first selector of the list. Now the first control in the body gets focus (the field in the quick switcher).
   - `ui/logic.ts`: `FOCUSABLE` matched `button` rows with `tabindex="-1"`, so the quick switcher's Tab trap ended on a row Tab
     skips and focus left the dialog for the status bar. Every part now excludes `tabindex="-1"` (test in `logic.test.ts`).
   - `ErrorScreen.tsx`: the details printed "Error: message" twice (name + message, then a stack that starts with the same line).

## Surfaces shot (all four size/theme combinations each)
- Quick switcher: `*-quick-switcher.png`, `*-quick-switcher-focus.png` (1440).
- Crash-report prompt: `*-crash-prompt.png`, `*-crash-prompt-focus.png`. A report was seeded in `<profile>/crash-reports/`.
- Render-error screen: `*-render-error.png`, `*-render-error-focus.png`, `*-render-error-report.png` (its Report button opens
  the prompt). Triggered by a temporary `throw` in `shell/Overlays.tsx` behind a localStorage key. It is removed; no trigger ships.

The quick switcher's 0x0 / opacity 0 dialog did not reproduce: with two file tabs open it is 640x228 at opacity 1 once the
fade (the app's 0.15s) is over, at both sizes, both themes. The old shot was taken mid-fade. No change made for it.

## Keyboard walks (1440x900, same at 1024x640 and in day)
- **Quick switcher** (Ctrl+Shift+P, two tabs): focus lands in the filter field. Tab: first row, Close, field, wraps (before the fix
  it left the dialog). Down from the field enters the list (walked); Up on the first row returning to the field is PickList's code, not walked. Ring on every stop.
  Esc closes and returns focus to where it was.
- **Crash prompt**: focus lands on the report text (a scrollable `pre`, one Tab stop). Tab: Never ask, Do not send, Send, Close,
  report, wrap. Ring on each. Esc closes (counts as Do not send; the report is marked offered).
- **Render-error screen**: Reload has focus. Tab: Copy details, Report, details text, Reload. Ring on each. Enter on Report
  opens the prompt; Esc closes it and focus returns to Report.

## Not done / left
- The Tasks column titles truncate with an ellipsis at 1024 (five narrow columns).
- Edits outside the listed paths, each needed by the above: `ui/Modal.tsx`, `ui/logic.ts` (+ test), `plan/PlanWaves.tsx`,
  `plan/usePlanPage.ts`, `plan/plans.css`.
