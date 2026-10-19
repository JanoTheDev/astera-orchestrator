You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md ("Wave 8", its contracts, and the W8-D row), docs/guide.md. Inspect the
existing code named here before writing anything. Extend existing code; do not build parallel systems. W8-C is
merged. This prompt runs inside the W8 plan, beside W8-A and W8-B. It touches none of their files.

# W8-D — Several plans in one repo, without overlapping work

Owner's words (2026-10-18): "what if i drop multiple different plans for a large project … they don't accidentally
do similar or overlapping work". Today:
- The same-file guard (W6-C) only compares Tasks of **one** plan: `editing.get(run.jobId)` in
  `src/core/orchestration/schedule.ts`.
- The planner only lists other plans' titles once, before planning (`planner-guide.md` step 2).

1. **Cross-plan file guard** (`schedule.ts`, `blocked.ts`):
   - Key `editing` by the Job's project (the same repo), not by `jobId`. A ready Task then waits while **any** plan
     of that project has an open Dispatch on overlapping `affectedPaths`, using the existing `pathsOverlap` /
     `sameFilesAs`.
   - Two plans in different projects never block each other.
   - The blocked reason names the other plan and Task: "Waits for Auth rework · T6 (same files: src/api/routes.ts)".
2. **Overlap check before approval** (new `core/orchestration/overlap.ts`, `planner.ts`, `planner-guide.md`):
   - `overlapsOf(job, state)` compares each of the plan's Tasks with every active or queued plan of the same project.
     A match is overlapping `affectedPaths`, or the same linked issue (`Task.links`).
   - It is stored on the Job as `Job.overlaps`, and refreshed whenever either plan's Tasks change.
   - The planner sees the other plans' Tasks (titles, paths, state) in its brief. It then either plans around them
     or names the overlap in `existing.md`. It never duplicates a Task another plan already holds (link it, as
     with issues).
   - Approval is never blocked by an overlap. The guard in step 1 makes it safe.
   - CLI: `astera jobs overlaps --id <job>`. Activity kind `plan.overlap`: feed and Inbox, no chime.
   - Until W9-D, the existing approve area shows one line per overlap. W9-D gives it the card with "Start after
     <plan>" (sets W8-C `Job.after`) and "Move <task> into <plan>".
3. **The replan between waves** (`replan.ts`) also reads the other plans' progress, so a later wave does not redo
   what another plan finished meanwhile.
4. **Plan areas** (`Job.areas?: string[]`):
   - The planner sets 1–3 short areas from its Tasks' paths, such as `auth`, `api` or `ui`.
   - Commands: `jobs-set --areas`, and `jobs-list --area`.
   - W9-C groups the Plans page by area and draws the Overlap view from `Job.overlaps` and `affectedPaths`.

## Done means
- Tests:
  - Cross-plan wait in the same project, and no wait across projects.
  - The blocked reason text.
  - `overlapsOf` by path and by issue.
  - Refresh on a Task change.
  - The planner brief includes other plans' Tasks.
  - Areas set and listed.
- One real run in a scratch repo: two plans whose Tasks touch one file. The second Task waits with the reason
  above, then runs after the first merges; the overlap shows before approval. Paste the timings and output.
- Run `npm run typecheck`, your tests, and the full suite via `astera heavy -- …` (W8-C) or the flock line. Paste
  the results.
- Add "Several plans in one repo" to USAGE.md.
- Only your ownership row changed. Delivery is the W8 plan's PR.
