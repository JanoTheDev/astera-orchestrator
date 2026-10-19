You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md (especially "Wave 8 — Who wrote this" and its contracts), docs/guide.md.
Inspect the existing code named here before writing anything. Extend existing code; do not build parallel
systems. Waves 6 and 7 are merged; build on them. Use the Wave 8 contract names exactly as PLAN.md spells them.
W8-A runs in parallel. Code against the note contract, not against W8-A's files. Until W8-A merges, your one
call into `stamp.ts` is marked `shortcut: wire into stamp.ts after W8-A merge`.

Worktree + branch (rule 1 in CONTEXT.md): slug `w8-line-attribution`, branch `feat/orch-line-attribution`.

# W8-B — Line-level attribution, and seeing it

Commit level (W8-A) covers worker worktrees, where one commit has one author. Lines matter when a human and an
agent edit the same commit: a worker on `runCwd`, or the owner's interactive tabs. That is git-ai's core
feature. Match it.

Read first:
- `core/hooks/sessionState.ts` (W6-E `lastActionOf`)
- `core/sessions/statusline.ts`: how hook entries are installed (W6-G did the same)
- `core/workUnit/collector.ts`: the EG §26 busy windows
- the file viewer under `core/files` and its renderer component
- the plan view `components/plan/*`
- the project settings page (W7-B)

1. **Spike first (time-box: half a day). Write the result in `docs/dev/LINUX.md`.**
   - Install git-ai with `HOME` set to a scratch dir, never the real `~`. Its installer edits global agent
     hooks.
   - Check four things:
     1. Its hooks coexist with the settings and hooks that Astera spawns workers with (`src/host/spawner.ts`).
     2. Attribution survives Astera's worktree, then `integrateGit` merge, then delivery.
     3. Its `refs/notes/ai` authorship log can be parsed into the Wave 8 `lines` shape.
     4. It adds no prompt to a worker's turn and no latency to a git command.
   - **Pass on all four:** use git-ai as the line engine. `gitAi.ts` detects `git-ai` on PATH, reads
     `refs/notes/ai` for a commit, and turns it into `lines`. Astera never installs it. The project settings
     row shows "Line attribution: git-ai detected", or "not installed" with the install command to copy.
   - **Any fail:** use the native engine (step 2). Record which check failed.
2. **Native engine (if the spike fails, or as a fallback when git-ai is not installed).**
   - Add a `PostToolUse` hook entry for `Edit`, `Write`, `MultiEdit`, and Codex `apply_patch`. Install it the way
     W6-G installs its hook.
   - The hook appends `{ session, path, addedLineHashes }` to a per-worktree checkpoint log in
     `checkpoint.ts`. Store hashes, never content. Keep the log outside the repo.
   - Files written by Bash while a session is busy (EG §26 window) count as that session's, whole-file. This is
     the same limit git-ai has.
   - `lines.ts`: at stamp time, match each added line of the commit diff to the checkpoint hashes.
     - Matched lines go to the session.
     - Everything else is human.
     - Mixed commits get `lines`. Pure ones leave it out, per the contract.
     - Clear the log for the committed range.
3. **UI** (`components/attribution/*`):
   - A blame toggle in the file viewer gutter: AI (agent/model chip) / human / unknown per line. Click it to
     see the Task, then the session.
   - In the plan view, per Task: AI and human lines.
   - On the project page: % AI, split by `tool_model_breakdown`, for the last delivery and all time.
   - Use the existing theme tokens. The chips are readable with a keyboard and a screen reader, not by
     colour alone.
4. Tests:
   - Hook: an Edit produces hashes and no content.
   - Mixed commit: an agent edits lines 1–5, then the owner edits 6–8 before the commit. `lines` holds 1–5 only.
   - A Bash-written file in a busy window goes to the session.
   - git-ai adapter: parse a fixture authorship log. Absent tool gives fallback, not an error.
   - UI: gutter states, plus the keyboard path.
   - Run full tests per CONTEXT.md rule 4 (`flock`, 2 workers).

Ownership: see the W8-B row of PLAN.md.
