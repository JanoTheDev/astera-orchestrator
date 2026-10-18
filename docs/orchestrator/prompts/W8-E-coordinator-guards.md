You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 6 — Autopilot" and its contracts, "Wave 7", "Wave 8", "Running the waves in Astera"),
docs/orchestrator/LINUX.md (section "Autopilot re-run (7V)") and docs/orchestrator/USAGE.md. Then read each GitHub
issue named here (`gh issue view <n> -R JanoTheDev/astera-orchestrator`: it has the repro, what the re-run saw and a
file guess) and inspect the existing code it names before writing anything. Extend existing code; do not build
parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w8-coord-guards`, branch `fix/orch-coordinator-guards`.

Runs in wave 8.0 beside W8-C, by hand: the W8 waves run as one Astera plan, and that plan needs these four fixes.

SPEC sections: §5, §6, §9.

# W8-E — The coordinator's path obeys the same rules as the Host's

The 7V re-run found that a plan with a coordinator skips rules the Host's own placing keeps, and that the coordinator
misses what the owner does. Every fix here is on the coordinator's path: `worker-start`, its inbox, and the end of a
Run.

Fix:
- **#92** The same-file guard does not hold when the coordinator places workers. A Job with a coordinator has no
  `autoDispatch`, so `slotsToFill` (`schedule.ts`) never places for it; the coordinator calls `worker-start`
  (`command.ts`), which checks concurrency and holds but never `sameFilesAs` / `editingByJob`. Refuse there with the
  same rule and a reason the coordinator can act on ("waiting for <title>: same files <path>; start it when that Task
  ends"), keep the board's "waiting for … same files" reason true for it, and add the line to
  `orchestration-guide.md`. Use `editingByJob` as it is: W8-D widens it across plans afterwards, and `worker-start`
  then gets that for free. Test in `command.test.ts`: start P1, then P2 on the same file is refused; after P1
  completes, P2 starts.
- **#95** The replan hold makes the coordinator open a false owner Gate. The W6-D replan holds with
  `Job.dispatchHold`, and the refusal says "`jobs-unhold` lets it go again", which agents cannot run, so the
  coordinator asked the owner (chime, Gate, Task blocked). While `job.replanning` is set, `worker-start` answers
  "replanning wave N: this lifts by itself; wait for plan.replanned in your inbox" (and says so in
  `orchestration-guide.md`). Also let `replan.ts` `notStarted` count a Task that is blocked only by an open Gate as
  not started, so a replan can still change it. Test both.
- **#96** The coordinator is not woken when the owner answers a Gate. It waits in `astera check --wait` (10 min) and
  only a typed nudge started P6 / F6+F7 sooner. Deliver a Gate resolution and an owner answer to the coordinator's
  inbox as a message `check --wait` returns on (the way W7-C delivers `usage.resumed`, `inbox.ts`,
  `exec/dispatchLoop.ts`). Test: a resolved Gate ends a pending `check --wait` within one tick.
- **#99** A plan that ends with a failed Task never ends. After the last Task finished with one `failed`, there was no
  final check, no `plan.done`, no notice and no branch note for 30 min. Make the running→failed transition emit
  `plan.done` with `runOutcome: 'failed'` (`activity.ts`, the `outcomeOfTasks` block), notify it as "Plan finished
  with N failed" (no chime), and run the delivery note (`run.pr` "on branch …") for the completed Tasks' work. Do not
  run the final check for a failed plan; say in the notice that it was skipped. Test the event and the notice.

Ownership: `command.ts` handler `worker-start` (and its hold refusal text), `inbox.ts`, `activity.ts` (the plan.done
block). Additive: `replan.ts` (`notStarted`), `exec/dispatchLoop.ts`, `src/main/activityNotices.ts` (one notice
kind), `resources/skills/orchestration-guide.md` (three lines; W8-C owns this file and runs beside you: keep your
lines in one block marked `W8-E`).

## Done means
- Every issue above fixed and covered by a regression test that fails without the fix.
- By hand in the dev app (one tiny plan in a scratch repo, CONTEXT rule 7): a fixlist with two same-file problems and
  no dependency runs them one after the other, and the board shows the reason; a two-wave plan crosses its replan with
  no Gate and no chime.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- USAGE.md: the same-file line under "Run", and what a failed plan looks like.
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator; its body says `Fixes #<n>` for each issue.
  Do not merge.
