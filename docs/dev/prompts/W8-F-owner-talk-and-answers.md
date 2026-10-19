You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md ("Wave 6 — Autopilot" and its contracts, "Wave 7", "Wave 8"), docs/dev/LINUX.md
(section "Autopilot re-run (7V)") and docs/guide.md. Then read each GitHub issue named here
(`gh issue view <n> -R JanoTheDev/astera-orchestrator`: it has the repro, what the re-run saw and a file guess) and
inspect the existing code it names before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w8-owner-talk`, branch `fix/orch-owner-talk`.

Part of the W8 Astera plan (after W8-C and W8-E merged).

SPEC sections: §4, §6.

# W8-F — What the owner says reaches the right session, once

The 7V re-run talked to the planner from the app, answered Gates and asks, and dropped scope in an answer. Each path
worked from the CLI but not from the app, or reached the worker but not the reviewer.

Fix:
- **#93** Planner box feedback from the app always starts a fresh planner. The CLI's `jobs feedback` typed or resumed
  (`via: "resumed"`, `claude --resume`); the same text from the Run window started a new planner every time, two alive
  at once. `exec/plannerFeedback.ts` needs `listSessions` / `sendSession` / `sessionTurn` / `agentSessionOf`, which the
  Host has (`src/host/orchDeps.ts` `HOST_SESSIONS`) and the app's command route does not. Route `jobs-feedback` from
  the app to the Host, or give main's route the same deps. Test that the app route answers `typed` for a live
  planner and `resumed` for an ended one.
- **#94** A feedback planner adds a Task without a basis, and approval refusal is only a toast that never leaves.
  `freshFeedbackBrief` must ask for `--basis` / `--evidence` as the first brief does (`handover.ts`), the "ready for
  approval" line and notice must wait until `validatePlan` holds (else the feed says what is missing), and the
  refusal toast closes on its own or when the plan changes. The Run window shows the problems above Run before it is
  pressed.
- **#97** Coordinator Gates, including the convergence Gate (`retry-once` / `mark-failed`), have no answer box; the
  card says "Waiting for an answer" and only the CLI works. Render W7-C's `components/plan/QuestionAnswer.tsx` for
  `task.gate` too (options as buttons, free text when the Gate allows it), sending what `gate-resolve` takes.
- **#98** `questions answer --answer -` keeps stdin's trailing newline: `"mark-failed\n"` missed the option and became
  free text. Trim stdin for `--answer -` (`cliArgs.ts` `wantsStdin` / `src/cli/run.ts`), and match options trimmed and
  case-insensitively in the handler (`command.ts` `questions-answer`). Test both.
- **#100** An owner answer does not change the Task's criteria, so the reviewer kept failing work the owner had
  scoped down (3 repairs, an escalation). When an owner answer (Gate or escalation) narrows a Task, the coordinator
  updates its `acceptanceCriteria` with `task-update` (say so in `orchestration-guide.md`), and the review brief
  (`reviewer.ts`, `exec/reviewGate.ts`) includes the owner's answers on that Task. Test that the brief carries them.

Ownership: `exec/plannerFeedback.ts`, `components/plan/QuestionAnswer.tsx` and its mount in `TaskBoard.tsx`, the
toast, `command.ts` handler `questions-answer`, `reviewer.ts`, `exec/reviewGate.ts`. Additive: `src/main/ipc.ts` (the
route), `cliArgs.ts` / `src/cli/run.ts` (trim), `handover.ts` (one brief line), `resources/skills/orchestration-guide.md`
(one line, marked `W8-F`), `components/plan/PlanTalk.tsx` (problems above Run).

## Done means
- Every issue above fixed and covered by a regression test that fails without the fix.
- By hand in the dev app (one tiny plan in a scratch repo, CONTEXT rule 7): two feedback rounds from the planner box,
  the first typed into the live planner and the second resuming it (`ps` shows `--resume`); a coordinator Gate
  answered from its card.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- USAGE.md "Talk to the planner" and "How you answer" match.
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator; its body says `Fixes #<n>` for each issue.
  Do not merge.
