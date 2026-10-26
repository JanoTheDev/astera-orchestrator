# Documentation screenshots

All PNGs are 1440x900, Night theme, shot from the `--showcase` seed (`docs/dev/shots/SEED.md`). `agents.png` is not
produced: the Agents view needs live sessions. `diagrams/` holds the SVG diagrams.

## Retake

```bash
P=<a fresh scratch dir>/prof
node scripts/shots-seed.mjs --profile "$P-dev" --showcase
ASTERA_PROFILE_DIR="$P-dev" astera heavy -- env -u ELECTRON_RUN_AS_NODE -u ASTERA_SESSION SHELL=/bin/bash \
  npx electron-vite dev --remoteDebuggingPort 9351 -- --user-data-dir="$P"
# The window may open on demo-app: pick storefront in the title bar switcher (Ctrl+Alt+4) before shooting.
npm run shots -- --port 9351 --out <dir> --sizes 1440x900 --themes night --pages <page>
```

Then copy `<page>-1440x900-night.png` to the name below. Afterwards close the app and stop the Host
(`host stop`; it refuses while the seeded plan counts as running, then end that Host process).

| Image | Shows | `--pages` |
|---|---|---|
| `plan-board.png` | "Checkout redesign": Steps with Tasks done, queued, in review and asking, models and accounts | `planboard` |
| `plan-board-day.png` | The same in the Day theme | `planboard` with `--themes day` |
| `plans-tree.png` | Plans side bar with the plan's Steps unfolded, plans in mixed states, next to the open plan | `planstree` |
| `main-plan.png` | Main plan page: every plan and its open Tasks | `mainplan` |
| `start.png` | Start tab: the New plan composer | `start` |
| `needs-you.png` | Bottom panel, Needs you, All projects: open questions and the plan awaiting approval | `needsyou` |
| `activity.png` | Bottom panel, Activity: the "Handled for you" feed | `activity` |
| `task-detail.png` | One Task expanded: criteria, result, attempts, review, files | `taskdetail` |
| `history.png` | History view with the project's sessions | `history` |
| `source-control.png` | Source Control: the worktree, its changes and commits | `scm` |
| `explorer.png` | Explorer with a file open in the editor | `editor` |
| `run.png` | Run view with run configurations | `run` |
| `accounts.png` | Accounts and usage: three accounts with usage bars | `accounts` |
| `settings-agents.png` | Settings > Agents: orchestration models per role | `settings-agents` |
| `project-switcher.png` | Title bar project switcher open, six projects | `switcher` |

The README images in `assets/` come from the same run: `ui-start.png` = `start`, `ui-plan-board.png` = `plan-board.png`,
`ui-inbox.png` = `needs-you.png`, `ui-plan-light.png` = `plan-board-day.png`, `ui-hero-dark.png` = `planboard` at
`--sizes 1920x600`. `ui-new-flow.png` is the New plan tab with a prompt typed in (not a `--pages` page).
`ui-agents-dark.png` and `ui-agents-light.png` are unchanged: they need live sessions.
