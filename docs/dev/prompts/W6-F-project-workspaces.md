You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md (especially "Wave 6 — Autopilot" and its contracts), docs/guide.md
and the SPEC.md sections named below. Inspect the existing code named here before writing anything. Extend
existing code; do not build parallel systems. Use the Wave 6 contract names exactly as PLAN.md spells them.

Worktree + branch (rule 1 in CONTEXT.md): slug `w6-workspaces`, branch `feat/orch-project-workspaces`.

SPEC sections: §5, §6.

# W6-F — One workspace per project (gameful, Astera, …), each with its own tabs

Today the sidebar is Projects → Plans → sessions, and selecting a **plan** scopes the pane grid to that plan's
sessions (`components/workspace/workspaceTree.ts` `scopeLayout`, `workspacePlanId` in `App.tsx`). The owner works on
several projects and wants to open one and see all its tabs.

Read first: `components/workspace/*`, the `workspacePlanId` state and pane-layout handling in `App.tsx`,
`core/projects/settings.ts`.

1. **Project workspace.**
   - Selecting a **project** scopes the pane grid to every session of that project:
     - its plans' planner, coordinator and worker sessions
     - plain tabs the owner opened whose cwd is inside the project folder (or one of its worktrees, see
       `core/worktrees`)
   - Tabs outside every project live in an "Other" workspace.
   - Selecting a plan still narrows to that plan.
2. **Per-project layout.** Each workspace remembers its own pane layout and focused tab while you switch away and
   back. Keep this in renderer memory, plus the existing layout persistence if there is one; do not invent a new
   store. A new tab opened while a project workspace is active starts in that project's folder.
3. **Switching.**
   - A project switcher at the top of the sidebar: each project with a count of running tabs, and a dot when one
     needs input.
   - A keybinding (Ctrl+Alt+1…9) for the first nine projects, added to the existing keybindings.
4. Tabs keep running in the background when you switch. This is already true; prove it with a test, do not
   re-implement it.

Ownership: see the W6-F row of PLAN.md.

## Done means
- Every item above works and is covered by a test that fails without it.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
