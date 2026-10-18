You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 6 — Autopilot" and its contracts, "Wave 7"), docs/orchestrator/LINUX.md (section
"Autopilot dogfood (W6-V)") and docs/orchestrator/USAGE.md. Then read each GitHub issue named here
(`gh issue view <n> -R JanoTheDev/astera-orchestrator`: it has the repro, what the dogfood saw and a file guess) and
inspect the existing code it names before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w7-ui`, branch `fix/orch-tabs-accounts-sidebar`.

SPEC sections: §7.

# W7-F — Tabs that stay manageable, accounts you can sign in and remove, a tidy sidebar

Owner's words (2026-10-18): "closed sessions … staying with a bar over them gets annoying, and navigating them when
there's too many tabs is also annoying"; "there's no way to remove an added account"; "make history collapsible like
the other sections"; adding an account "seems to be broken".

Fix:
- **#84** Ended sessions keep a struck-through tab (`.tab.exited`, `styles.css`), and one afternoon left 21 tabs in
  one project. Ended tabs of a finished or archived plan close on their own once the plan ends (their scrollback stays
  readable from the plan's tree and History); a plain session's ended tab stays until closed, as now. A setting turns
  auto-close off. For many tabs: an overflow menu listing every tab of the workspace, and a quick switcher (open with
  a rebindable key, Settings → Shortcuts) that filters tabs by name, plan and Task, like search does (`hw1`).
  Each replan must not leave another planner tab behind.
- **#82** Accounts: "+" makes an empty folder and nothing says how to sign in, and removing is only in Settings →
  Accounts. The owner wants adding an account to be one click and a login link. "+" → name → Astera runs the CLI's
  login for that config dir itself (`CLAUDE_CONFIG_DIR=<dir> claude` with `/login`, or `claude auth login` if the
  installed CLI has it; check `claude --help`), reads the OAuth URL it prints, and shows it in a small dialog as a
  link plus "Open in browser" and "Copy". Paste-back of the code, if the CLI asks for one, happens in the same dialog.
  The dialog closes when the login probe (`claudeLoginProbe`) turns true. A not-logged-in row offers the same "Sign
  in". Every row offers "Remove" (the existing unregister flow and its confirmation from `AccountSettings.tsx`,
  including "Also log out"). Codex: the same through `codex login`. Never log or store the URL's token part.
- **#83** HISTORY is the only sidebar section without a collapse chevron. Use the same header and remembered state as
  WORKSPACES and ACTIVITY.
- **#77** Re-logging an account's folder (`claude /login` in `~/.claude`) keeps the old label and usage. On each login
  check, when the folder's email changed, update the label (unless the owner renamed it) and drop the old usage
  reading.
- **#78** A session made by `astera sessions create` is not the window's session until its tab is clicked (footer "No
  sessions", Jobs "No project is open"); Workspaces says "No projects yet" with projects registered. An adopted tab
  that comes forward is the active session; Workspaces lists registered projects without plans.
- **#79** The Jobs panel is clipped at the default sidebar width. Make it wrap.
- **#76** Board: planned cards say "Model CLI default" before dispatch (show `resolveWorkerModel`'s answer),
  "1 questions answered" (plural), the wave column is a small inner scroll box, and the Run window can fall into an
  empty "No Tasks yet" view after a backdrop closes.

Ownership: the tab strip component and its styles in `styles.css`, the sidebar account panel, `HistoryBrowser.tsx`,
`JobsView.tsx` layout, `components/plan/planBoard.ts` / `TaskBoard`. Additive: `App.tsx` (tab and active-session
state, auto-close), keybindings, `AccountSettings.tsx` (export the unregister flow), `core/accounts` (email check),
`components/workspace/workspaceTree.ts`.

## Done means
- Every issue above fixed; logic (auto-close rule, switcher filter, email-change relabel, model shown) covered by
  tests that fail without the fix. UI-only changes checked by hand in the dev app with a screenshot each in the PR.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- USAGE.md "The workspace" and "Before the first plan" updated (tabs, switcher key, sign in and remove an account).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator; its body says `Fixes #<n>` for each issue.
  Do not merge.
