You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, docs/orchestrator/LINUX.md, and the SPEC.md sections named below. Then inspect
the existing code named here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w2-planner`, branch `feat/orch-planner-stage`.

SPEC sections: §2, §11.

# W2-A — Separate planning stage (premium planner, plan-only)

Today one coordinator LLM session (`startCoordinatorSession` in `exec/workerStart.ts`, prompt in
`handover.ts`, guide `resources/skills/orchestration-guide.md`) both plans and starts workers.
`Job.pendingStart` already means "drafted, not started yet" — reuse it as the approval boundary.

Build:
- Owner's mental model: "I talk to someone, they open a terminal with Claude, Claude plans it, sees it's
  done, gives me all the prompts, and opens as many terminals as needed with Claude or Codex." Make that
  loop work end-to-end from the UI in this task (W3-B later adds talking to it by voice/text).
- Planner session: new `exec/plannerStart.ts` reusing the coordinator spawn path, model from
  `resolveRoleModel(..., 'planner', ...)` (W1-A). Runs while the Job is `pendingStart`. Gets the
  objective, repo root, and is told to read the repo's own CLAUDE.md/AGENTS.md and follow them.
- Plan-only enforcement in code, not just in the prompt: commands from a planner session may create /
  edit Tasks and deps but `worker-start`, `merge`, and anything that dispatches are rejected (find how
  `command.ts` knows the calling session/role — e.g. orchestration env on spawn — and gate on it). The Host
  runs these commands too and drives Jobs (CONTEXT.md rule 7), so the gate must hold there; test it through
  the Host's command path. The
  planner's settings must also deny file-edit tools if the existing per-session `--settings` mechanism
  (`src/core/sessions/statusline.ts`) allows it; if not, explain.
- Wave 0 note: permission bypass is **off by default** (CONTEXT.md rule 7), so the planner and workers will
  hit Claude permission prompts. The planner must not need the bypass (it only creates Tasks through
  `astera` commands; make sure those are covered by the session's allowed tools, or say what the owner must
  allow). Never enable the bypass from code.
- Structured task fields (append to `interface Task`): `prompt` (explicit worker prompt; `spec` stays),
  `acceptanceCriteria: string[]`, `affectedPaths: string[]`, and set W1-A's `difficulty` (and optionally
  `provider`/`model` with a one-line reason) on every task so workers get a fitting model. Worker spec file
  (`OrchCoordinator.startWorker`) includes them. Validation: every Task needs prompt + ≥1 acceptance
  criterion; deps must reference existing tasks; no cycles (reuse `graph.ts` if it detects cycles).
- Persist a human-readable `plan.md` next to orchestration data (path under the profile dir per Job) and
  keep the structured data in `orchestration.json` as today.
- New `resources/skills/planner-guide.md` instructing: analyze, don't implement, produce tasks via the
  commands, maximize safe parallelism, list affected paths so parallel tasks don't collide.
- Approval: the existing "Run"/start action on a pendingStart Job = approve plan → execution
  (coordinator/autoDispatch as today). UI: `NewRunModal.tsx` gets "Plan with planner first" option; the
  existing start action for a `pendingStart` run (`JobsView.tsx`, `lib/jobActions.ts`) becomes a clear
  "Approve & execute" button. Do not edit `RunDetail.tsx` (W2-C) or `App.tsx` (W2-B) this wave.
- Tests: planner cannot dispatch, task validation (missing criteria, unknown dep, cycle), approval
  transition, plan.md written, worker spec contains the new fields.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
