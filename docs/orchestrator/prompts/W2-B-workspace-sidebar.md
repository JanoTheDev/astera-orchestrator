You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, docs/orchestrator/LINUX.md, and the SPEC.md sections named below. Then inspect
the existing code named here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w2-sidebar`, branch `feat/orch-workspace-sidebar`.

SPEC sections: §5, §6, §12 (sidebar, switching).

# W2-B — Workspace sidebar: Project → Plan → sessions

Today the sidebar shows CLI history; orchestration has `Project`/`Job`; sessions live in the Host and the
pane tree (`src/core/panes/tree.ts`) is in-memory only; renderer state is `useState` in `App.tsx`.

Build:
- New `src/renderer/src/components/workspace/` sidebar section: expandable Projects → Plans (Jobs, using
  W1-C `title`, hide archived unless toggled) → that plan's sessions grouped as Planner / Coordinator /
  Workers (derived from Run.coordinator session + Dispatch.sessionId; label "Trading Worker 2"-style).
- Clicking a plan opens its workspace (existing Run detail area / pane layout) showing only that plan's
  sessions; clicking a session focuses its live terminal (reuse existing pane/terminal components — no
  new terminal).
- Switching plans must not kill/restart processes, lose scrollback, change cwd, or route input to
  another plan. Find how scrollback is held today (Host registry replay vs xterm instance) and prove it
  with a test or documented manual check.
- Each session header shows project, plan, task, model (W1-A Dispatch field), account, cwd, branch,
  status (attention idle/working/waiting).
- Derive everything from orchestration data so the tree rebuilds after restart.
- Only you edit `App.tsx` this wave: keep the change to mounting + selected-plan state.
- Tests: pure tree-building function (projects/jobs/runs/dispatches → tree), session grouping, archived
  filter.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
