You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md (especially "Wave 6 — Autopilot" and its contracts), docs/guide.md
and the SPEC.md sections named below. Inspect the existing code named here before writing anything. Extend
existing code; do not build parallel systems. Use the Wave 6 contract names exactly as PLAN.md spells them.

Worktree + branch (rule 1 in CONTEXT.md): slug `w6-replan`, branch `feat/orch-wave-replanning`.

SPEC sections: §2, §3.

# W6-D — Replan between waves, and a final "is it really done" check

Plans drift: a wave finishes but something was missed or turned out harder. Before the next wave starts, the
planner looks at what really happened and fixes the rest of the plan.

Read first: `exec/plannerStart.ts`, `resources/skills/planner-guide.md`, `planner.ts` (`validatePlan`,
`PLANNER_COMMANDS`, `plannerRefusal`), `task-update` in `command.ts` (the `PLAN_EDIT` fields), the `jobs-hold` /
`dispatchHold` work from W5-C, and how #47 (W5-B, PR #57) ends the planner session.

1. **Waves.** New pure `replan.ts`:
   - `waveOf(task, tasks)` = dependency depth (contract in PLAN.md).
   - `waveOpen(task, state)`: with `job.replan !== 'off'`, a Task of wave n+1 may start only once every Task of
     wave n is completed **and** no replan is running for the Job.
   - Add exactly one filter call to `slotsToFill` (additive; W6-C owns that file).
2. **Boundary trigger.** In `exec/dispatchLoop.ts`, when the last Task of wave n completes and wave n+1 has Tasks:
   1. Set the Job's `dispatchHold`.
   2. Emit `plan.replanning`.
   3. Start a **fresh** planner session through new `exec/replanStart.ts`. Reuse `plannerStart`'s spawn; only the
      prompt differs.
3. **Replan prompt.** Give the planner:
   - the objective and owner instructions
   - per completed Task: its `worker_done` summary, the review verdicts and its changed files (`runs-changed-files`)
   - the remaining Tasks
   It may only:
   - `task-update` Tasks that have not started
   - add Tasks (`task-create`)
   - cancel a not-started Task with a reason
   It never touches completed or running Tasks: enforce this in the `task-update` / cancel handlers for replan
   sessions, not only in the guide. When it ends (planner end from #47), run `validatePlan` on the remaining
   graph, clear the hold and emit `plan.replanned` with a one-line summary of what changed. If `validatePlan`
   fails, keep the hold and escalate (`task.escalated`, W6-B).
4. **Final check.** After the last wave completes, run the same replan session once more in "completion" mode:
   compare the result with the objective, and either declare done or add follow-up Tasks as a new wave. At most 3
   follow-up waves per Job (`replanFollowUps` counter on the Job); the 4th time escalates instead.
5. `Job.replan: 'waves' | 'off'` (default `'waves'`), settable via `jobs-create` / `jobs-plan` and a toggle in the
   Job settings.
6. planner-guide.md gets a "Replanning" section with the rules above.

Ownership: see the W6-D row of PLAN.md.

## Done means
- Every item above works and is covered by a test that fails without it.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
