You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md (especially "Wave 6 — Autopilot" and its contracts), docs/guide.md
and the SPEC.md sections named below. Inspect the existing code named here before writing anything. Extend
existing code; do not build parallel systems. Use the Wave 6 contract names exactly as PLAN.md spells them.

Worktree + branch (rule 1 in CONTEXT.md): slug `w6-progress`, branch `feat/orch-progress-view`.

SPEC sections: §9.

# W6-E — A plan view that shows the waves, the files and what each tab is doing

Today `components/plan/` has a progress bar and per-bucket counts (`PlanOverview.tsx`) and the task board
(`TaskBoard.tsx`, `planBoard.ts`, reasons from `blocked.ts`). Make it the place the owner watches a plan run.
Before building UI, read `docs/guide.md` and the existing `components/plan/*.css` and
`components/workspace/workspace.css`: use the app's existing tokens and components. Make it look good: calm, dense,
readable.

1. **Waves.** The board groups Tasks into wave columns or sections ("Wave 1 · 3/4 done"). The current wave is
   highlighted. A replan in progress shows as a banner on the next wave ("Replanning wave 3…", from
   `plan.replanning` / `plan.replanned`).
2. **Files.** Each task card lists its `affectedPaths`, collapsed after 3. A "Files" tab on the plan view lists every
   affected path, which tasks touch it and their status, so overlap is visible at a glance. Clicking a path opens
   it in the file explorer.
3. **What each tab is doing.**
   - Add `SessionInfo.lastAction` (contract in PLAN.md) from the last `PreToolUse` hook payload: `tool_name` plus
     `file_path` / `command` (first 80 chars) / `pattern`. Use a new `lastActionOf` in `core/hooks/sessionState.ts`;
     the Host carries it in `src/host/sessions.ts`.
   - Each running task card shows a one-line "now": "Editing src/x.ts · 12 s ago", "Running npm test", "Waiting
     for your permission", "Asked the coordinator" (from `task.waiting` / the inbox).
   - Clicking the card focuses that tab.
4. **Questions answered.** Show `question.auto-answered` lines on the task card as a small expandable "2 questions
   answered", so the owner can audit the coordinator.
5. Progress counts and the bar stay as they are (SPEC §9 buckets). Add per-wave progress.

Ownership: see the W6-E row of PLAN.md.

## Done means
- Every item above works and is covered by a test that fails without it.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
