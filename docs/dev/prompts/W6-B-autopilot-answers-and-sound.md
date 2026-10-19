You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md (especially "Wave 6 — Autopilot" and its contracts), docs/guide.md
and the SPEC.md sections named below. Inspect the existing code named here before writing anything. Extend
existing code; do not build parallel systems. Use the Wave 6 contract names exactly as PLAN.md spells them.

Worktree + branch (rule 1 in CONTEXT.md): slug `w6-autopilot`, branch `feat/orch-autopilot-answers`.

SPEC sections: §3, §9, §12.

# W6-B — The coordinator answers workers; the owner hears only what needs them, with a sound

Read first: `inbox.ts` (`NO_COORDINATOR_ANSWER`), the `ask` / `reply` / `questions-*` / `send` cases in `command.ts`
(note `send --type escalation` is "recorded only", around the `// status, escalation and heartbeat` comment), the
coordinator section of `resources/skills/orchestration-guide.md`, `src/main/desktopNotifier.ts`,
`core/orchestration/activity.ts`, `core/hooks/sessionState.ts`.

1. **Questions go through Astera.** Spawn Claude workers so Claude's `AskUserQuestion` tool is disallowed (find
   where `exec/workerStart.ts` builds the claude args; use the CLI's disallowed-tools flag and verify the flag name
   against the installed `claude --help`). Tell workers, in the worker part of the guide: "Ask with `astera ask`;
   you will get an answer." Permission prompts are **not** changed: the `sessions-send` refusal stays (security
   review).
2. **Coordinator answering policy** (orchestration-guide.md, coordinator section):
   - Answer every question from `plan.md`, the spec files, `inputs/` and the repo.
   - Escalate (`astera send --type escalation --reason …`) only for owner decisions: product or UX choices the plan
     does not settle, anything irreversible, data loss, security, money, or a question asked twice with no
     progress.
   - Each answer is recorded so it is visible (next item).
3. **Feed.** Emit `question.auto-answered` (question, answer, task) when a coordinator replies: a feed line and a
   line on the task, no notice. Make `send --type escalation` emit `task.escalated`: a feed line, a desktop notice
   through the existing throttled notifier path, and it shows in the "needs my input" inbox (W3-C reads gates and
   `task.waiting`; add escalations the same way). A Gate that opens because review rounds ran out (W6-C) is also an
   escalation.
4. **Sound.** New `renderer/src/lib/alertSound.ts`: a short two-note chime with WebAudio (no audio file, no
   dependency). Play it when the app shows a notice for `task.escalated`, `task.waiting` (permission or question)
   or a new open Gate. At most one chime per 5 s. Add an app setting `alertSound` (default true) with a toggle next
   to the other notification settings. Electron's `Notification` stays `silent: true` when the chime plays, so
   there is no double sound.

Ownership: see the W6-B row of PLAN.md.

## Done means
- Every item above works and is covered by a test that fails without it.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
