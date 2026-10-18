You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md (Waves 6–9 and the "Running the waves in Astera" section), docs/orchestrator/LINUX.md
("Autopilot dogfood (W6-V)") and docs/orchestrator/USAGE.md. Inspect the existing code named here before writing
anything. Extend existing code; do not build parallel systems. Waves 6 and 7 are merged. **Run alone**, before W8-A
and W8-B: after this one merges, they and every later wave run as Astera plans instead of hand-opened tabs.

Worktree + branch (rule 1 in CONTEXT.md): slug `w8-self-host`, branch `feat/orch-run-waves`.

# W8-C — Astera runs its own waves

Owner's words (2026-10-18): "i have so many waves that needs to be ran after each other … can this whole thing be
automated". Today each wave is prompt files pasted into hand-opened tabs, plus a MERGE tab. Astera already does
every step of that for one plan (planner, parallel workers in worktrees, same-file guard, reviewer, integration
merge, final check, delivery). Three things are missing.

1. **Prompt files as Tasks, verbatim** (`--mode prompts`, `core/orchestration/intake.ts`, `cliArgs.ts`,
   `cliUsage.ts`, `planner-guide.md`, the New flow's source picker):
   - Each attached `.md` becomes exactly one Task. Its text is the Task prompt **unchanged**: the planner may not
     rewrite, merge or split it.
   - The planner fills `affectedPaths` from the prompt's "Ownership" / "Owns" lines and PLAN.md's ownership table,
     `deps` from PLAN.md's wave table ("Depends on", "run alone"), and the model from the difficulty.
   - `validatePlan` checks that there is one Task per file and that each prompt equals its file's text.
   - A prompt's own instructions to open a PR and stop are superseded by the plan's integration and delivery. Add
     one line to the worker brief: "Ignore the prompt's worktree, branch, push and PR steps; Astera gives you a
     worktree and delivers the plan."
2. **Plan after plan** (`Job.after?: string`, a job id, in `types.ts`, `schedule.ts`/`jobActive`, `blocked.ts`):
   - A queued plan stays `pendingStart` until the plan it names is **delivered**. Its planner then starts by itself,
     and the rest follows the project's approval setting (W7-A auto-approve).
   - If the earlier plan gives up or is archived, the queued plan waits and escalates once ("Waiting on <plan>,
     which stopped").
   - CLI: `jobs-create --after <job>`; `jobs-set --after <job|none>`. New flow: a "Start after" field.
   - The Home tree and board show "Queued after <plan>".
3. **One heavy job at a time, machine-wide** (the owner's laptop has crashed from this; see memory rule in CONTEXT
   rule 4 and 7):
   - Add `astera heavy -- <cmd…>`. It runs the command under a Host-wide lock (one at a time, FIFO, with the queue
     shown in the board's live line as "Waiting for the heavy-job slot (2nd in line)").
   - Wrap with it: the full suite, `npm run dev` / Electron launches, `npm run dist:linux`.
   - Workers are told in `orchestration-guide.md` to use it, and `flock /tmp/astera-fullsuite.lock` keeps working
     for hand-opened tabs. Use the same lock file, so both kinds share one queue.
4. **Self-hosting safety** (document it in USAGE.md "Running the waves in Astera", and verify it):
   - The Astera that runs the plan uses the normal profile, from the packaged AppImage or `~/.config/astera`.
   - Workers' manual checks run the dev app on the dev profile (`~/.config/astera-dev`), with its own Host.
   - A worker must never stop, restart or `pkill` the orchestrating app or its Host. Add this to the worker brief.
   - Check that two Hosts on two profiles coexist: separate sockets, and no adoption of each other's sessions.
     Record the result in LINUX.md.

## Done means
- Tests: one Task per prompt file, and a rewrite of a prompt is refused; `after` gating (delivered → starts; gave up
  → waits and escalates once; cycle refused); the heavy lock is FIFO and released on crash or exit; the worker
  brief lines are present.
- A real run in a scratch repo:
  - Two queued plans, each made from two tiny prompt files. Plan 2 starts by itself after plan 1 delivers.
  - Two workers call `astera heavy -- sleep 5` together; they run one after the other.
  - Paste the timings.
- `npm run typecheck` clean; your tests pass; full suite run with
  `flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2` and the results pasted in the PR.
- USAGE.md has a "Running the waves in Astera" section with the exact commands for Wave 8 and Wave 9 (PLAN.md lists
  them).
- PR into `main`. Do not merge.
