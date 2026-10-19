You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md ("Wave 6 — Autopilot" and its contracts, "Wave 7"), docs/dev/LINUX.md (section
"Autopilot dogfood (W6-V)") and docs/guide.md. Then read each GitHub issue named here
(`gh issue view <n> -R JanoTheDev/astera-orchestrator`: it has the repro, what the dogfood saw and a file guess) and
inspect the existing code it names before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w7-answers`, branch `fix/orch-owner-answers`.

SPEC sections: §6, §9.

# W7-C — The owner can answer, and the coordinator hears it

The W6-V dogfood escalated "EUR or USD?" correctly, then the owner had no way to answer it, and the coordinator did
not hear the answer for 7 minutes. Fix the whole path from "needs your decision" to the worker getting the answer.

Fix:
- **#72** No way to answer an escalation or a worker's `astera ask` question. An ask is a `messages` row, and
  `questions-list` (`command.ts`) reads Gates only, so `questions list/get/answer` cannot see it. Make
  `questions list/get/answer` cover open asks too (one list, the existing answer path delivers to the worker as the
  coordinator's answer does today, and the coordinator gets a copy). In the app: the escalated Task's card and its
  needs-input row get an answer box (the row's click opens the card or the box; today it does nothing). An answer
  from the owner is a feed line ("answered by you"), never a notice.
- **#73** The coordinator waits in long blocking shell loops (`for i in $(seq 1 110) … sleep 5`) and misses owner
  messages and `usage.resumed`. In `resources/skills/orchestration-guide.md`, tell it to wait with `check --wait` and
  a short timeout, never a shell sleep loop. When `usage.resumed` fires (`usageGuard.ts` `UsageChange`), tell the
  coordinator of each affected Run to retry its held starts (`sessions send` the way the Host already messages a
  coordinator), or let the Host place them for a Run without a live coordinator. Test: a held Task starts within one
  dispatch tick after the pause ends, with no typed nudge.
- **#71** The escalation notice showed but no chime played (`desktopNotifier.ts` `activity()` → `show()` with
  `chime`, `notify:chime` to the renderer). Find where `chime` became false or the IPC was lost, fix it, and add a
  test that runs a polled `task.escalated` event through `startActivityNotices` to `show({ chime: true })`.
- **#75** A session whose turn ended reads `waiting`, like one at a prompt. Keep `waiting` for a real prompt or
  question, and make a finished turn `idle` (`core/sessions/attention.ts`, `sessionStateOf`, the Stop hook).
  The needs-input badge and inbox must not count finished sessions.

Ownership: `inbox.ts`, `command.ts` handlers `ask` / `questions-*`, `resources/skills/orchestration-guide.md`,
`src/main/desktopNotifier.ts`, `src/main/activityNotices.ts`, `core/sessions/attention.ts`, the answer box in
`components/plan/*` (not W7-A's `PlanTalk.tsx`). Additive: `usageGuard.ts` (a change listener), `exec/dispatchLoop.ts`,
`components/workspace/*` (the inbox row click), `src/main/index.ts` (`show`).

## Done means
- Every issue above fixed and covered by a regression test that fails without the fix (or, where the issue says so,
  the limitation explained in the PR with the smallest extension).
- By hand in the dev app (one tiny plan in a scratch repo, CONTEXT rule 7): a worker asks an owner question, you
  answer it from the card, the worker gets it within seconds; you hear one chime with the notice.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- USAGE.md "Questions and escalations" says how the owner answers.
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator; its body says `Fixes #<n>` for each issue.
  Do not merge.
