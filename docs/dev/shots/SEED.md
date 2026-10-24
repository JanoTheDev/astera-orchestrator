# Shots seed: every screen without real agents

`scripts/shots-seed.mjs` fills a dev profile so a screenshot run reaches the screens the W12 before-shots could not
(see `w12-before/NOTES.md`, "Not reached"): a plan page, error states, the run tools panel, the Files context menu,
the New task form and the Create PR dialog. It starts no agent and does not run `astera projects add`. It writes the
profile's stores directly, in the shapes the app writes them.

## Command

Quit the app first, and stop the Host for that profile. The Host holds `orchestration.json` in memory and writes it
back. The script refuses a profile whose `host/host.pid` names a live process. It also refuses `~/.config/astera`.

```bash
# A fresh profile. The unpackaged app appends "-dev" to its userData (src/main/index.ts), so
# `--user-data-dir=$P` really opens "$P-dev". Seed the "-dev" folder.
P=/tmp/shots-profile
node scripts/shots-seed.mjs --profile "$P-dev"

# Start the app on it (one Electron at a time, a fresh port). SHELL picks the shell "New terminal" opens.
ASTERA_PROFILE_DIR="$P-dev" astera heavy -- env -u ELECTRON_RUN_AS_NODE -u ASTERA_SESSION SHELL=/bin/bash \
  npx electron-vite dev --remoteDebuggingPort 9351 -- --user-data-dir="$P"
npm run shots -- --port 9351 --out <dir>

# Afterwards: close the app, end the bash run if you started one, then stop that profile's Host.
ASTERA_PROFILE_DIR="$P-dev" ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron out/main/cli.js host stop
```

You can also seed the shared dev profile (`--profile ~/.config/astera-dev`). Other tabs use that profile and its Host,
so a temporary profile is safer.

The script prints the repo path and the ids it wrote (`proj_5eed…`, `job_5eed…`, `run_5eed…`, `gat_5eed…`). A
re-run replaces only its own records: those whose ids contain `_5eed`, the `shots-seed/` folder, its worktree and
run-config entries, and its feed lines (`ev_5eed00000000_*`). Everything else in the profile is kept.

## What it seeds

| Store | What it writes |
|---|---|
| `<profile>/shots-seed/demo-app` | A git repo with 3 files and 2 commits on `main`. A worktree `shots-seed/worktrees/settings-page` on branch `shots/settings-page`, 1 commit ahead. |
| `orchestration.json` (+ `.last-good`) | Project `demo-app` (`proj_5eed000000000001`). Two plans, described below. |
| `worktrees.json` | The worktree, `baseRef: main`. |
| `windows.json` | The project first in `open`, so the first window opens on it. |
| `run-configs.json` | The run config `bash` (`type: shell`, `command: bash`) for the repo. Never `claude` or `codex`. |
| `app-settings.json` | Written only when missing: `firstRunAsked: true`, so onboarding does not cover the app. |
| `orch/activity.jsonl` | 5 feed lines for Inbox "Handled for you": a failed worker, a failed Task, a failed PR push, an opened question, a finished worker. Numbered after the lines already there. |

**Plan "Settings page"** has finished:
- 2 Tasks completed and 1 failed (3 failures in a row).
- Its Run's delivery failed (`deliveryState.state: 'failed'`, `lastCode: main-diverged`).
- The plan page shows "Not delivered: …" with **Retry delivery**, **It's already pushed** and **Dismiss**.

**Plan "Dark mode toggle"** is paused:
- 1 Task completed.
- 1 Task `dispatched`, which reads "Plan paused".
- 1 Task `blocked` on an open Gate. This is the owner question "Which theme should new users see first?" with options Night, Day and Follow the system.
- 1 Task `pending`, waiting on the two above.

## Plan shots

Before/after shots of the New plan page, Sessions (Agents) view, History sessions tree, project switcher and Main plan
page live in `docs/shots/before/` and `docs/shots/after/` (un-ignored in `.gitignore`). The seed gives them 3 projects
(`demo-app`, `api-server`, and the workspace `acme` with sub-project `web`), 3 plans (failed delivery, paused with an
open question, delivered) and 5 finished sessions for History (account `shots-seed`, Claude transcripts under
`shots-seed/claude-home`). Start the app as under "Command", then:

```bash
npm run shots -- --port 9351 --out docs/shots/after --sizes 1920x1080,1000x800 --pages start,sessions,history,switcher,mainplan
```

Files are `<page>-<WxH>-<theme>.png` (`--themes night,day`, default both). `--pages` takes any of: sessions, plans,
start, mainplan, history, explorer, scm, run, devices, switcher, accounts, settings (default: all); `--sizes` defaults
to `1440x900,1024x640`. The Sessions shot shows the empty state: a live agent session needs a signed-in account.

## How the Host is kept idle

No orchestration flag parks a Job outright. Pause and archive do not stop the auto-answerer or the stall watchdog.
The seed therefore uses only states the Host's passes leave alone. `scripts/shots-seed.test.mjs` checks each one
against the real core functions.

- **Delivery.** The finished Run's delivery is `failed`. `deliveryDue` is never true for it, so only the owner's
  buttons act on it. The paused Run's delivery is preset to `pending`, so `openCompletedRunPrs` has nothing to write.
- **Placing.** The paused Job has `paused`, `dispatchHold`, a paused Run, no `autoDispatch`, no coordinator and no
  planner. `jobActive` and `appDriven` are false, so the scheduler places nothing. `replan: 'off'`.
- **Recovery and resume.**
  - Every Dispatch is closed. The `dispatched` Task's Dispatch was ended `closedBy: 'pause'`, so it is not a lost
    worker: recovery `candidates()` is empty.
  - `runGatedForTask` is true for the paused Run's Tasks.
  - No `coordinatorSessionId` exists, so crash-resume has nothing to restart.
  - Loading through `OrchestrationStore` changes nothing: no Dispatch closed, no Task interrupted, nothing pruned.
- **Questions.** The Gate's Task spec says "Ask me", so `autoAnswerOf` leaves it to the owner. The open Gate also
  keeps the stall watchdog from escalating the paused plan.
- **Merges and PRs.** No Run has a `worktree`, so wave merges and draft PRs never run.

**Checked live** (2026-10-22, temporary profile, one dev-app start, about 3 minutes):
- `host/host.log` shows only these lines: start, `worktree clean-up: removed 0, kept 0`, the `bash` run's pty starting and exiting, and the retire. There was no dispatch, resume or delivery.
- `orchestration.log` says `restart cleanup … 0 open dispatch(es)`.
- Afterwards `orchestration.json` held exactly the seeded Tasks, Dispatches, Gate and delivery states. No new messages or gates.

## Reaching each screen (CDP or by hand)

| Screen | How |
|---|---|
| Start page | The app opens on `demo-app`. Use New › "plan it for me" (as `shoot.mjs` does). |
| Plans list | Ctrl+3: shows both plans and the "Not delivered: …" line. |
| Plan page | Ctrl+3, then click "Settings page" (failed delivery, wave cards, failed Task) or "Dark mode toggle" (paused). Leave it with the header's "← Plans" button. |
| Tasks | Ctrl+2: kanban with Planned 2, Needs you 2, Done 3, and a "New task" button. |
| Inbox, errors | Ctrl+4: "Needs you" shows the theme question. "Handled for you" shows red rows (worker failed, PR failed) and a warning row. |
| New task dialog | On a plan page: "Show details", then the **Waves** tab, then **Add task**. The form shows inline. Cancel closes it. The Tasks page's "New task" opens the Start form instead. |
| Tools panel | Turn on Settings › General › **Advanced mode**, then More › **Run configs**. The bottom panel opens with the `bash` config. **Run** starts a plain `bash` pty in the project folder. "New terminal" opens `$SHELL`. |
| Context menu | Click **Files** in the top bar, then right-click `README.md` (`.fx-row`). The menu offers New File, Rename, Delete, Copy Path and more. If a terminal has focus, Ctrl+digit goes to the terminal: blur it or click the top bar instead. |
| Worktrees | More › Worktrees: one row, `shots/settings-page ↑1`. |
| Create PR dialog | Worktrees, click the row, then the detail's **More** › **Create PR**. The dialog reads "shots/settings-page → main … 1 commits will be in this pull request". Cancel it: submitting needs a remote and gh. |

## Open defects (T33 status: the Files read failure is fixed at the message, not at the stale project)

- **Files "Read failed: Error invoking remote method 'files.list'" on `~/.config/astera-dev`.** This is not an
  allow-list problem.
  - The dev profile's open project "two" is registered in `orchestration.json` `projects` at `/tmp/w9proj/two`,
    and that folder no longer exists. None of that profile's 10 projects exists on disk.
  - `assertAllowedPath` (`src/main/ipc.ts`, `files.list` handler) accepts the path, because it is a registered
    project. Then `fs.readdir` throws `ENOENT: no such file or directory, scandir '/tmp/w9proj/two'`.
  - The renderer passes `currentProject = scopeRoot ?? activeTabRoot ?? stickyRoot` (`useJobs.ts`).
  - `scopeRoot`, the switcher's project path, is never dropped when its folder is gone. "All projects" also keeps
    it, and it rewrites `cm.currentProject` each time. So the sticky root's own `files.list` check cannot clear it.
  - With the seeded project the explorer lists the repo normally.
  - Fix options:
    - Drop or skip a scope project whose folder is missing, as `stickyRoot` already does.
    - Have `files.list` report "project folder missing".
    - Prune dead projects from that profile.
- **Status (T33).** The Files note no longer shows "Error invoking remote method 'files.list'" (`useFileTree.ts` strips the IPC prefix with `errText`; `FileExplorer.tsx` says "This folder no longer exists." for ENOENT; test: `hooks/useFileOps.test.ts`). The stale project is still selectable: `scopeRoot` in `useJobs.ts` is not dropped when its folder is gone. That change is in a state file outside this Task's paths.
- **`--user-data-dir` gets a `-dev` suffix** in the unpackaged app, so seeding the folder you pass opens an empty
  profile. Seed `<dir>-dev`, as shown above.
- **Tools panel needs Advanced mode.** More › Run configs is hidden in simple mode (`SIMPLE_MORE_PAGES`). The seed
  does not change settings in an existing profile, so turn Advanced mode on by hand or over CDP.
- **Not covered:** the "about" card, the history and jobs sidebars, and help. These are unchanged from the
  before-notes. An ask-type question (`astera ask`) is not seeded either, because it needs a live worker session; the
  open Gate stands in for it. The 30-minute stall watchdog was not watched live. The open Gate is what keeps it quiet
  (`stallWatch.ts` `ownerAsked`).
