# W12 plan page and Tasks: what changed, for the visual check

Code only; no shots taken here (the final visual-check Task shoots every screen). Before: `../w12-before/` (no live
plan was reachable there, so the plan page has no before shot; compare with `../w11-after/` if present).

## What changed

All controls on the plan page and Tasks page are ui primitives now (`components/ui` barrel). No raw `<button>`,
`<select>`, hand-made menu, `window.confirm`, glyph-character icons or hand-drawn lock SVGs remain in these files.

- **PlanHeader**: icons from the registry; rename box is ui `Input`; overflow is a ui `Menu` labelled "More" (with a
  tooltip). Wave 1's failed-delivery actions (Retry, It's already pushed, Dismiss) stay visible in the header.
  Plain words: Stalled chip, pause tooltip, "Restart the lead agent", "Agents at once". No filled button in the header.
- **PlanOverviewSection**: Start reads "Start" (was "Run"), with the run icon; it is the view's one primary.
- **Steps (waves)**: shown as "Step N" in dependency order everywhere (board headings, graph layer labels, header line,
  replan banner, Tasks wait chip "Step 2 of 3 running"). View switch is labelled "Show steps as".
- **Why it waits** (`JobTask.board` from `taskBoardsOf`): plain-word reason line on each waiting card (board and
  Tasks page chip); on the graph a node's hover text is "title — why it waits". Wording uses "lead agent", "agent",
  "files in use by …", "agent limit".
- **TaskBoard**: fold/unfold a step is a ghost Button (folded) or IconButton "Fold step N" (open), both with chevron
  icon and `aria-expanded`. Card title is a ghost Button (keeps `aria-pressed`). Branch link is a ghost Button inside a
  `Tooltip` explaining "worktree". "+N more" files and "N questions answered" are ghost Buttons with `aria-expanded`.
- **PlanGraph**: the 7 node actions are `IconButton size="sm"` (Open its tab, Start, Hold with a question, Answer its
  question, Stop, Start again (refresh icon, was Play), Stop auto-fix); disabled ones keep their reason as title.
  Node title is a ghost Button, so a node can now be selected by keyboard. Check marks ✓ ✗ ○ ! ● are icons
  (check, close, pending, warning, loading). Edges and legend lines stay SVG (they are the drawing, not icons).
- **Questions for you** (GateAnswer, QuestionAnswer): heading "Question for you"; every option is its own Button;
  the first option takes focus in GateAnswer when there is no text box; Ctrl+Enter answers from the box; GateAnswer's
  confirm reads "Answer" (was "Unlock") and is the primary; Cancel is ghost; close is an IconButton "Cancel".
  QuestionAnswer has an `autoFocus` prop (off by default: many cards can render at once).
- **PlanTalk**: Stop, Send, Reject, Cancel are ui Buttons; message box is ui `Textarea` (Ctrl+Enter sends);
  Reject opens a reason `Input` that takes focus (Esc cancels); Send is secondary so Start stays the one primary.
- **AutoApproveToggle**: ui `Switch`.
- **PlanJournal**: clear-filter, cancel and open-session are IconButtons; ask box is a labelled `Textarea`; new
  chevron IconButton per event with a body (keyboard twin of the row click, `aria-expanded`).
- **PlanFiles / ChangedFilesBlock / TaskLinkChips / PlanChanges**: ghost Buttons with registry icons; file rows keep
  `aria-pressed` and `is-open`; link chips keep their titles and open GitHub as before.
- **TasksPage**: icons from the registry where it has the glyph.
- Wording sweep (en, es, ja, ko): worker → agent, coordinator → lead agent, gate → question for you, wave → step,
  Runtime → that computer, job → plan, re-dispatch → start a new attempt.

## Keyboard map

Tab follows visual order; the focus ring comes from the primitives (`:focus-visible`).

1. Header: Back, plan title (double-click or the More menu to rename; Enter keeps, Esc drops), status chips and their
   Needs-you / Fix / failed-Task buttons, Agents at once, Its consoles, Pause, Retry, It's already pushed, Dismiss,
   Talk to planner, More (menu: arrows/Home/End/typeahead move, Enter/Space pick, Esc closes and refocuses More).
2. Section tabs (advanced or "Show details"): arrows move between tabs.
3. Overview: Start (primary), questions for you (options, then box, then Cancel, then Answer), Show/Hide details.
4. Steps: Graph/Board tabs (arrows), Add task; Board: per step the fold control, then per card: title, branch
   (tooltip on focus), "+N more", "questions answered", answer controls. Graph: nodes row by row, title then actions.
5. Talk to the planner: Stop, message box (Ctrl+Enter sends), Send, Reject (reason box: Enter rejects, Esc cancels).
6. Journal: clear filter, per event chevron then open-session; ask form: box, Cancel, primary.
7. Files / Changes: path button then its task buttons; changed-files toggle then file rows.
8. Tasks page: New task, plan scope (segmented tabs, arrows), planning cards (and their console button), board cards.

Enter/Space activate every button. Esc closes the More menu, the Start-after menu, dialogs (ConfirmDialog/Modal,
NewTaskModal) and cancels the GateAnswer form and the talk reject box.

## Moved or renamed controls

No control was removed or moved to a different place. Renamed: "Run" → "Start" (overview); "Unlock" → "Answer"
(question form); graph "Lock"/"Unlock" → "Hold with a question"/"Answer its question"; graph "Start again" now has a
refresh icon. New: journal event chevron, graph node title as a focusable button.

## Look for in the visual check

- Graph node action IconButtons are 18px to fit the 54px the node keeps for them.
- `.detail-clear`, `.detail-jump`, `.detail-gate-options > button` in `runDetail.css` (not this Task's file) may fight
  the ui button styles; overrides live in `plan.css` (`/* W12 journal/files */`) and `planBoard.css` (`/* W12 plan steps */`).
- Header carries 6+ ghost buttons; "Its consoles" could move into More (not done: no control moves without the owner).
