You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, docs/orchestrator/LINUX.md, and the SPEC.md sections named below. Then inspect
the existing code named here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w4-final`, branch `chore/final-linux-verification`.

SPEC sections: all, especially §11 and §10.

# W4 — End-to-end verification on Linux

Run ALONE after Wave 3 is merged.
1. Fresh `npm ci`, `npm run typecheck`, `flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2` — all green or each failure explained.
2. `npm run dev` and walk the SPEC §11 milestone by hand with a real small repo (create a scratch git repo
   with a few files): create project + plan, run planner (premium model), approve, watch parallel workers
   on real `claude` sessions, type into one, pause/resume the plan, close and reopen the app (no duplicate
   workers), check activity feed, needs-input inbox, command bar ("show progress on <plan>", "pause worker
   2" → confirm).
3. `npm run dist:linux`, run the AppImage, repeat a short smoke.
4. Update `docs/orchestrator/LINUX.md` and write `docs/orchestrator/USAGE.md` (how I use the
   orchestrator day to day). File issues in this repo (`gh issue create`) for anything broken, with
   repro steps.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
