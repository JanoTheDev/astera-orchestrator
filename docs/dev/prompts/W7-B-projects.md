You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md (especially "Wave 6 — Autopilot", its contracts, and "Wave 7"), docs/guide.md
and the SPEC.md sections named below. Inspect the existing code named here before writing anything. Extend
existing code; do not build parallel systems. Wave 6 is merged; build on it. Use the Wave 6 and 7 contract names exactly as PLAN.md spells them.

Worktree + branch (rule 1 in CONTEXT.md): slug `w7-projects`, branch `feat/orch-projects`.

SPEC sections: §1, §5.

# W7-B — New projects and existing projects, each with its own settings

Astera is for every project the owner works on: gameful, other existing repos, and brand-new ones. Today a
Project is only registered implicitly (`projects-list` / `projects-get` / `projects-find`). A fresh `git init` repo
has no commit, so worktrees are switched off (`core/worktrees/base.ts`) and parallel Tasks cannot fork. Each project
also needs its own way of working.

Read first:
- `Project` in `types.ts` and the `projects-*` cases in `command.ts`
- `core/worktrees/base.ts`
- `exec/validator.ts` and run configs (`run-configs`)
- W6-H's `Project.delivery`
- W7-A's auto-approve toggle
- `core/projects/settings.ts` (the per-folder default account)

1. **New project.** A "New project" dialog and `projects-create --name --parent [--describe <text>] [--github private|public]`:
   1. Create the folder, which must not exist yet. Then run `git init -b main`.
   2. Write a `.gitignore` and a short `CLAUDE.md`, both from the description: what it is, stack, conventions,
      "Follow the GitHub rules below". Then make the **initial commit**, so worktrees work from the first plan.
   3. Register the Project.
   4. `--github`: only when the owner ticks it in the dialog, because it is outward-facing.
      `gh repo create <name> --private|--public --source . --push`, through the injected GhRunner.
   5. Offer to start the first plan with W6-A's intake right away ("Build the first version: …").
2. **Add an existing project.** `projects-add --path`, plus a folder picker:
   1. The path must be a git repo. With no commit yet, offer to make the initial commit; never commit the owner's
      files without asking.
   2. Detect the default branch.
   3. Propose a test/validation command from what is there: `package.json` scripts, `Makefile`, `pyproject`,
      `Cargo.toml`, `go.mod`. The owner confirms or edits it. Store it the way run configs already store commands;
      do not invent a second store.
3. **Project settings page.** One page per project, with every per-project choice in one place:
   - delivery `pr` / `push` and its branch (W6-H)
   - auto-approve (W7-A's toggle)
   - the test command
   - default worker concurrency (≤ 10)
   - review rounds
   - replan `waves` / `off` (W6-D)
   - default account (the existing setting)
   - `projects-set` covers each one
   - Defaults for a project nobody set up: delivery `pr`, auto-approve off, concurrency 3, review rounds 5,
     replan `waves`.
4. **Workspace.** A new or added project appears in W6-F's project switcher at once, with its own workspace.
5. Tests:
   - create in a temp dir: folder exists → refused; initial commit present; worktree fork works afterwards
   - add: not a repo → refused; no commit → asks
   - test-command detection per ecosystem
   - settings round-trip and defaults
   - `gh repo create` only with the flag

Ownership: see the W7-B row of PLAN.md.
