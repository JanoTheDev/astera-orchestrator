You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: CONTEXT.md (architecture map + rules you must follow), PLAN.md ("Running the waves in Astera",
its "Later: no attaching" paragraph, and the wave table) and the user guide. W9-G moved them: look in `docs/dev/` and
`docs/guide.md` first, then `docs/orchestrator/`. Read W8-C's prompt and its merged code in
`core/orchestration/intake.ts` (`--mode prompts`) before writing anything. Extend that code; do not build a second intake.
Waves 8 and 9 are merged.

Worktree + branch (rule 1 in CONTEXT.md): slug `w10-run-by-name`, branch `feat/orch-run-by-name`.

# W10-A — Run as written, by name: no attaching

Owner's words (2026-10-18): "so i just put the text and then itll find the files so i dont have to attach? … im all
for effiency so for a later update id like it to work that way". Today Run as written needs every prompt file attached
plus the order pasted into Instructions (`RUN-W8-W9.md`). The owner wants to type only the text.

1. **A prompts folder per project** (`types.ts` project settings, `astera projects set --prompts-dir <path|none>`,
   the project settings page, one row):
   - Default: none. On the first Run as written without attachments, detect one: the folder (repo-relative,
     at most 3 levels deep) holding the most files named like `W<n>-<X>-*.md`. Show it in the Start page as
     "Prompts from `docs/dev/prompts`" with a Change link, and save it once a plan runs.
   - A path outside the repository is refused.
2. **Names in the text become attachments** (`intake.ts`, `--mode prompts`):
   - When a Run as written plan has no attachments, the text is scanned for prompt ids: `W8-A`, `W9-B`, and ranges and
     lists written the way the owner writes them (`W8-A, B, D`, `W9-{A,B,C}`, `W8-A…D`, `all of W9`).
   - Each id resolves to exactly one file in the prompts folder (`<id>-*.md`). The file is copied into the plan's
     inputs as if attached, and from there everything is W8-C's code: one Task per file, verbatim, `validatePlan`
     checks it.
   - "All of W9" means every `W9-*` file the wave table does not mark done.
   - **Refused before any planner starts** (in the Start page, inline, and `INVALID_ARGUMENT` from the CLI): an id with
     no file, an id with two files, a range whose ends are in different waves. The message names each id.
   - Attachments and names together: attachments win, names are ignored with a notice ("Using the 16 attached files;
     the names in the text were not looked up").
   - The text stays the Instructions: the order lines in it still drive the planner as W8-C does.
3. **"Run the next waves"** (same code path): the text `next wave` or `next waves` (or the Start page's "Next waves"
   button, shown when the project has a prompts folder) picks every prompt of the first wave in PLAN.md's wave table
   that is not done, or every wave not done for "waves". The approval lists what was picked and why.
4. **The approval shows the resolution:** each Task's id → file path, and the ids skipped as done.

## Done means
- Tests: id parsing (single, list, braces, range, "all of"), resolution (none, one, two files; outside the repo
  refused), detection of the prompts folder, attachments-win notice, "next wave(s)" picking from a PLAN.md-style
  table with done rows, and a refused name never starting a planner.
- A real run in a scratch repo: a prompts folder with 4 tiny prompts and a 2-row wave table; the text
  `run P1-A, B then P2-A` with nothing attached makes 3 Tasks in 2 waves; `next waves` afterwards picks nothing.
  Paste the approval text.
- `npm run typecheck` clean; your tests pass; full suite through `astera heavy` (or
  `flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`), results in the PR.
- The user guide's Run as written section shows the no-attach way first. `RUN-W8-W9.md` is deleted (or moved to
  history) and its link removed.
- PR into `main`. Do not merge.
