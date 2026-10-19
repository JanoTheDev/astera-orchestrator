You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md (especially "Wave 6 — Autopilot" and its contracts), docs/guide.md
and the SPEC.md sections named below. Inspect the existing code named here before writing anything. Extend
existing code; do not build parallel systems. Use the Wave 6 contract names exactly as PLAN.md spells them.

Worktree + branch (rule 1 in CONTEXT.md): slug `w6-intake`, branch `feat/orch-intake-github`.

SPEC sections: §2, §7.

# W6-A — Plan from a PDF, an audit, a problem list or GitHub issues

Today a Job takes one objective string (`jobs-create`) or one issue (`jobs-create-from-issue`,
`core/sources/objective.ts`). Add the four ways the owner actually starts work. Every intake ends as **one Job**
whose planner gets the source and the owner's extra instructions.

1. **Attachments** — `jobs-create --attach <path>` (repeatable). Copy each file into the plan's spec folder
   (`plans/<jobId>/inputs/`, next to `plan.md`; see how `exec/specFiles.ts` places spec files and gives workers read
   access) and list them in the planner's objective: "Read every file in inputs/ first (PDFs over 20 pages in page
   ranges)". No PDF parsing in Astera: Claude's Read tool reads PDFs. Refuse paths that are not regular files or are
   over 30 MB (trust boundary: the path comes from the UI or CLI).
2. **Mode** — `jobs-create --mode plan|audit|fixlist` (default plan), in new pure `core/orchestration/intake.ts`
   that builds the objective text:
   - `audit --scope <path|all>`: the planner first audits that scope for bugs, security holes and missing tests,
     writes its findings to `inputs/audit.md`, then plans fixes for them.
   - `fixlist`: the objective is a problem list; one or more Tasks per problem, each Task naming which problem(s)
     it closes.
3. **Extra instructions** — `jobs-create --instructions <text>`, appended under "Owner's instructions" (they win over
   the source when the two conflict).
4. **GitHub**
   - `github-issue-assign --issue <n>[,<n>…] [--me]`: `gh issue edit <n> --add-assignee @me` through the injected
     GhRunner (`core/github/gh.ts`).
   - The GitHub job source (`issueSource.ts`) gets an "assigned to me" filter (`assignee:@me`). The `LEAVING`
     regex must still strip repo/org/user/is qualifiers.
   - `jobs-create-from-issue` accepts several issues (`--issue 12,14,19`) plus `--assign-me`, and makes **one** Job
     whose objective lists every issue (reuse the one objective writer in `sources/objective.ts`). Keep the
     non-member refusal per issue: one refused issue refuses the whole call and names it.
5. **UI** — a "New plan" dialog (new `components/intake/*`, mounted where `NewRunModal.tsx` / `JobsView.tsx` start a
   Job). It has:
   - source tabs: Describe, Files (drop PDFs), Audit (scope picker), GitHub (search with "assigned to me" and
     multi-select, plus an "Assign me" checkbox)
   - one "Extra instructions" box
   - the project picker
   It calls the commands above. Nothing else.

6. **Check what already exists before planning** (saves usage: nothing is built twice). Every intake, whatever its
   mode, starts the planner with this step. Write it as a "Before you plan" section in
   `resources/skills/planner-guide.md` (additive; W6-D owns the file).
   1. Follow the repository's own rules first. The guide already has the planner read `CLAUDE.md` / `AGENTS.md`;
      add `CONTRIBUTING.md` and `.github/` templates. Its GitHub workflow decides issues, branches and PR
      linking; `core/github/taskLinks.ts` already defers to it.
   2. Look for the work already done or under way:
      - search the code for each requested item
      - search open and closed GitHub issues and PRs (`gh issue list --search`, `gh pr list --search`)
      - list this project's other open Jobs (`jobs-list --project`)
   3. Write `inputs/existing.md`: one row per requested item with a state (`missing` / `partial` / `broken` /
      `built`) and its evidence (file:line, issue or PR number, Job id).
   4. Plan by state:
      - `missing`: build Tasks.
      - `partial`: Tasks for the missing part only.
      - `built`: no build Task. Run a short audit of that code (bugs, missing tests, edge cases against the
        request). If issues turn up, the item becomes `broken`; otherwise it is reported as done.
      - `broken`: fix Tasks, each naming the evidence.
      - An open issue, PR or Job that already covers an item is linked (`task-link-issue`), never duplicated.
   5. Nothing left to do: the planner ends with no Tasks. The Job ends as "nothing to do" with `existing.md` as
      its summary, and no tabs open. Emit `plan.nothing-to-do`, a feed line plus notice.
   6. Enforce this in code, not only in the guide:
      - Add `Task.basis: { state: 'missing' | 'partial' | 'broken'; evidence: string }` to `types.ts` (additive)
        and to `PLAN_EDIT` in `task-update`.
      - `validatePlan` (`planner.ts`, additive) refuses a Task without a `basis` or with empty evidence, so `run-start`
        cannot open tabs for unchecked work.
      - The plan view (W6-E) may show `basis` as a small tag.

Ownership: see the W6-A row of PLAN.md.

## Done means
- Every item above works and is covered by a test that fails without it.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
