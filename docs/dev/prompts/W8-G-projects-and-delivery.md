You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md ("Wave 6 — Autopilot" and its contracts, "Wave 7", "Wave 8"), docs/dev/LINUX.md
(section "Autopilot re-run (7V)") and docs/guide.md. Then read each GitHub issue named here
(`gh issue view <n> -R JanoTheDev/astera-orchestrator`: it has the repro, what the re-run saw and a file guess) and
inspect the existing code it names before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w8-projects`, branch `fix/orch-projects-delivery`.

Part of the W8 Astera plan (after W8-C and W8-E merged).

SPEC sections: §3, §8.

# W8-G — Projects and delivery from a fresh folder

The 7V re-run made its project with W7-B's "New project", gave it a bare `origin`, and ran plans with both delivery
modes. Each gap below cost a manual step or a wrong base.

Fix:
- **#101** On a project with no remote and delivery `pr`, a plan's work stays on its branch and the next plan builds on
  `main` anyway: the audit planner wrote Tasks "based on 93edbee" (the last plan's branch), workers started on
  `main`, reviewers demanded the missing fixes. Before planning, list the project's unmerged plan branches in
  `existing.md` and the planner brief (`handover.ts`), with "plan the work on the default branch; this branch is not
  merged". At the end of a `pr` plan on a project with no remote, say in the notice how to merge the branch
  (`git merge <branch>` in the folder) instead of only naming it.
- **#102** Push delivery stopped on "origin/HEAD is not set" although `projects create` recorded `defaultBranch: main`.
  `exec/integrateGit.ts` falls back to `Project.defaultBranch` before refusing. Test with a bare origin that has no
  HEAD ref.
- **#103** A plain tab's non-git folder (`sessions create --cwd /tmp/x`) became a project with settings, in the
  switcher and the New plan list. Find where a tab's cwd is registered as a project and apply the git check that
  `projects add` has; drop such entries on load (they hold no plans).
- **#104** First run: "+ New project" and "Add project" are disabled until a tab is open (`App.tsx` `projectAnchor`).
  Let both dialogs work with no tab (the Host answers `projects-create` / `projects-add` without an anchor folder).
- **#105** The plan PR body names each Task's account by email, and links source issues with `Refs #n` so a merge does
  not close them (`src/core/github/taskLinks.ts` `planPrTasksOf`, the `Closes`/`Refs` line). Use the account's label
  only when it is not an email address (else its short id), and `Closes #n` for issues the plan was made from
  (`jobs-create-from-issue`). Test both.

Ownership: `exec/integrateGit.ts` (the default-branch fallback only; W8-A adds stamping here, keep hunks apart),
`src/core/github/taskLinks.ts`, `components/projects/*`, the project auto-registration site. Additive: `handover.ts`
and `core/orchestration/intake.ts` (unmerged branches in the brief and `existing.md`; W8-C owns `intake.ts`, keep it
one block marked `W8-G`), `App.tsx` (`projectAnchor`), `core/orchestration/delivery.ts` (the no-remote notice text).

## Done means
- Every issue above fixed and covered by a regression test that fails without the fix.
- By hand in the dev app (CONTEXT rule 7): "+ New project" from an empty window; a bare `origin` with no HEAD; one
  tiny `push` plan lands on `main` and is pushed with no manual delivery branch.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- USAGE.md "Projects" and "Delivery" match.
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator; its body says `Fixes #<n>` for each issue.
  Do not merge.
