You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, docs/orchestrator/LINUX.md, docs/orchestrator/USAGE.md and the SPEC.md sections named below.
Then read each GitHub issue named here (`gh issue view <n> -R JanoTheDev/astera-orchestrator`: it has the repro and a
fix idea) and inspect the existing code it names before writing anything. Extend existing code; do not build parallel
systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w5-holds`, branch `feat/orch-holds-command-bar`.

SPEC sections: §6, §8.

# W5-C — Pause a worker, stop launching a plan, and command-bar fixes

Fix:
- **Command bar cannot be closed (owner report).** `components/command/CommandBar.tsx` closes only on Escape while
  focus is inside the bar, or on Ctrl+Shift+K again. After a click into a terminal there is no way out. Add a close
  button (labelled, keyboard reachable), close on a pointer-down outside the bar, and close on Escape from anywhere
  while it is open. Closing mid-recording must still stop the microphone (the existing `open` effect). Don't close it
  while the app's confirmation dialog it opened is up. New strings go in every locale file the bar already uses.
- **#38** No per-worker pause. Add a held Dispatch (`Dispatch.held`, Host commands `worker-hold` / `worker-unhold`):
  the session stays open, nothing is sent to it, and `slotsToFill` counts it as occupied. Map the bar's `pause` /
  `resume` on a worker target to it, behind the existing confirmation.
- **#39** No non-destructive "stop launching" for a plan that is not scheduled. Add `Job.dispatchHold`: `slotsToFill`
  / `jobActive` place nothing for it, `worker-start` refuses for it, nothing is closed. Set and clear it from the
  bar's pause and a Jobs-view button; no confirmation needed (nothing is killed). The bar's current
  `runs-stop` stays as a separate, confirmed "stop".
- **#40** The Run window's **Run** button (`startRunNow` in `RunDetail.tsx`) starts workers with no confirmation.
  Go through `approvePlan` (`lib/jobActions.ts`) and show its `problems`.
- **#41** The bar's archive/delete only act on plans of the project the Jobs view has open (`d.snapshotFor` in
  `components/command/execute.ts`). Read the counts the confirmation needs on demand (`orch.list` for that project).

Ownership: `components/command/*`, `core/intents/*`, `schedule.ts`, `RunDetail.tsx`, `lib/jobActions.ts`. Additive:
`types.ts` (`Dispatch.held`, `Job.dispatchHold`), `command.ts` (the two new commands, the `worker-start` refusal),
`exec/dispatchLoop.ts` (respect the holds), `JobsView.tsx` (button), the Host gates (`core/host/*Gate.ts`: an MCP client
may not hold/unhold, like `run-start`).

## Done means
- Every issue above fixed and covered by a regression test that fails without the fix (or, where the issue says so,
  the limitation explained in the PR with the smallest extension).
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator; its body says `Fixes #<n>` for each issue.
  Do not merge.
