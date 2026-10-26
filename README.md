<div align="center">

<img src="assets/mark.svg" width="72" alt="Astera mark" />

# Astera

**Hand it a plan. It runs the agents. It asks you only when it must.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Linux%20first-555)](docs/dev/LINUX.md)
![Version](https://img.shields.io/badge/version-1.4.14-informational)
[![CI](https://github.com/JanoTheDev/astera-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/JanoTheDev/astera-orchestrator/actions/workflows/ci.yml)
![Works with Claude Code and Codex](https://img.shields.io/badge/works%20with-Claude%20Code%20%7C%20Codex-8A63D2)

[At a glance](#at-a-glance) · [How it works](#how-it-works) · [Run it](#run-it) · [What it does](#what-it-does) · [Architecture](#architecture) · [The `astera` command](#the-astera-command) · [Docs](#documentation)

<img src="assets/ui-hero-dark.png" width="960" alt="Astera's Plans view: the Checkout redesign plan with its Steps and Tasks, each showing a model and an account, and the plan's Activity log on the right" />

</div>

Astera is a desktop app that runs many Claude Code and Codex terminals for you. You give it a goal or a source (an
issue, a folder of written plans), a planner splits it into Tasks, and workers run them in parallel, each on the right
model. A reviewer checks every Task, the plan is delivered the way you chose, and Astera asks you only when it must.

Every agent is a real `claude` or `codex` terminal, never an imitation of one. You can watch any of them and type into
any of them without stopping the rest.

## At a glance

- **Parallel workers, one worktree each.** Tasks that do not touch the same files run side by side, and Astera merges
  finished Tasks itself.
- **A reviewer on every Task.** A fresh reviewer checks each Task (up to 5 rounds), and a final check compares the
  result with the goal.
- **Account rolling.** When an account reaches its usage limit, Astera reads the reset time and resumes the work on the
  next account.
- **It asks only when it must.** Permission prompts, questions and failed reviews wait in one place, **Needs you**.

## How it works

<div align="center">
<img src="assets/docs/diagrams/plan-lifecycle.svg" width="760" alt="The life of a plan: a goal goes to the planner, you approve, the coordinator starts workers in waves, a reviewer checks each Task, then a final check and delivery" />
</div>

1. **Add a project.** A project is one git repository. Add an existing folder or create a new one, optionally with a
   GitHub repository.
2. **Start a plan.** **New → Plan it for me** opens the Start tab: write a goal, pick GitHub issues, audit a path, or
   attach your own files. **Run as written** turns each prompt file (or each `##` section of one document) into one
   Task with its text unchanged.

   <img src="assets/docs/start.png" width="760" alt="The Start tab: the What do you want done composer with With me, On its own and As written, a Start planning button and shortcuts such as Fix bugs and From GitHub issues" />

3. **Approve or talk.** The plan lands in the bottom panel's **Needs you** tab. Read the Tasks, then press **Approve & execute**. Or tell the
   planner what to change and it replans. Turn on auto-approve for a project to skip this step.
4. **Watch it run.** The **Agents** view lists every console, and each one opens as its own tab. A coordinator places workers as their
   dependencies finish. Tasks that touch the same files never run at the same time, not even across plans. Between
   waves a fresh planner adjusts what has not started yet. After the last wave a final check compares the result with
   the goal.

   <img src="assets/docs/plan-board.png" width="760" alt="A plan tab with Steps: Step 1 done, Step 2 with Tasks done, in review and asking, Step 3 waiting, each Task with its account and attempts, and Plan settings below" />

5. **Answer in Needs you.** Permission prompts, questions Astera cannot answer itself and failed reviews wait in one
   place, with a sound and a desktop notice. Everything Astera did without you is listed beside them.

   <img src="assets/docs/needs-you.png" width="760" alt="The Needs you tab listing open questions from several projects and a plan ready for approval, under a plan's summary with an express-pay question and answer buttons" />

6. **It delivers.** Per project or per plan, one of four modes: **pr** opens one pull request and never merges it.
   **push** merges into the delivery branch and pushes it, after the reviews, the final check and the tests pass.
   **merge** merges into the delivery branch on this computer and never pushes. **manual** pushes the plan's branch for
   safekeeping and leaves the finished plan for you. Astera stops and asks when anything is off, and never force-pushes.

Before planning, the planner checks what already exists: the code, GitHub issues and pull requests, and your other
plans. Nothing gets built twice.

## Run it

Linux is the platform it is built and tested on. You need:
- Node ≥ 22.13, `python3`, `make` and `g++` (`node-pty` is compiled on install);
- the `claude` CLI on your `PATH`, and `codex` if you use Codex;
- `gh`, signed in, for pull requests.

```bash
git clone https://github.com/JanoTheDev/astera-orchestrator.git astera && cd astera
npm ci
npm run dist:linux                         # builds dist-installer/astera-*-x86_64.AppImage
./dist-installer/astera-*-x86_64.AppImage  # profile: ~/.config/astera
```

`npm run dev` runs the development app on its own profile (`~/.config/astera-dev`).

First run:
1. **Settings → Accounts & usage → +**: add one or more Claude or Codex accounts and sign in.
2. **Settings → Agents → Orchestration models**: the model per role. Defaults: planner and reviewer `opus`,
   coordinator `haiku`, workers by Task difficulty (light `haiku`, standard `sonnet`, hard `opus`).
3. **Settings → Integrations → CLI → Install the astera command**.
4. Set a git identity (`git config --global user.name` / `user.email`).

Agents stop at every permission prompt until you answer it. Turn that off only for repositories you trust:
**Settings → Agents → Run agents without permission checks**.

## What it does

Astera is a VSCode-style workbench. The **activity bar** on the left switches the side bar between six views: **Agents ·
Plans · Explorer · Source Control · History · Run** (`Ctrl+1…6`). Consoles, files, plans, settings and worktrees open as
**tabs** in editor groups that you can split. `Ctrl+Shift+P` opens the command palette.

<table>
<tr>
<td width="33%" valign="top"><a href="docs/guide.md"><img src="assets/docs/plans-tree.png" alt="The Plans side bar as a tree of plans, steps and Tasks next to the open plan tab" /></a><br /><b>Plans</b><br />A tree of plan, step and Task, grouped by plan, status or area. <a href="docs/guide.md">Guide</a></td>
<td width="33%" valign="top"><a href="docs/guide.md#needs-you"><img src="assets/docs/needs-you.png" alt="The Needs you tab with open questions and a plan ready for approval" /></a><br /><b>Needs you</b><br />Questions, approvals and failed reviews in one list, with a bell in the status bar. <a href="docs/guide.md#needs-you">Guide</a></td>
<td width="33%" valign="top"><a href="docs/guide.md"><img src="assets/docs/activity.png" alt="The Activity tab: a time-ordered feed of what Astera did on each plan" /></a><br /><b>Activity</b><br />The feed of what Astera handled without you, filterable. <a href="docs/guide.md">Guide</a></td>
</tr>
<tr>
<td valign="top"><a href="docs/concepts.md"><img src="assets/docs/task-detail.png" alt="One Task expanded: done-when criteria, result, attempts, review issues and changed files" /></a><br /><b>Task detail</b><br />Criteria, result, attempts, review and files for one Task. <a href="docs/concepts.md">Concepts</a></td>
<td valign="top"><a href="docs/usage-guide.md"><img src="assets/docs/history.png" alt="The History view listing a project's sessions with their account and age" /></a><br /><b>History</b><br />Every session of a project, by account. <a href="docs/usage-guide.md">Usage guide</a></td>
<td valign="top"><a href="docs/guide.md"><img src="assets/docs/source-control.png" alt="Source Control: a worktree with its changes, a symbol map of the review and a Create pull request button" /></a><br /><b>Source Control</b><br />Worktrees, their changes and a review map. <a href="docs/guide.md">Guide</a></td>
</tr>
<tr>
<td valign="top"><a href="docs/usage-guide.md"><img src="assets/docs/accounts.png" alt="The Accounts panel with three accounts and their 5-hour and weekly usage bars" /></a><br /><b>Accounts</b><br />Several accounts per vendor, with usage bars. <a href="docs/usage-guide.md">Usage guide</a></td>
<td valign="top"><a href="docs/usage-guide.md"><img src="assets/docs/run.png" alt="The Run view listing seven run configurations" /></a><br /><b>Run</b><br />Run configurations for dev servers, tests and scripts. <a href="docs/usage-guide.md">Usage guide</a></td>
<td valign="top"><a href="docs/getting-started.md"><img src="assets/docs/plan-board-day.png" alt="The same plan tab in the Day theme" /></a><br /><b>Day theme</b><br />Night and Day themes. <a href="docs/getting-started.md">Getting started</a></td>
</tr>
</table>

**Plans.**
- Per-role models: coordinator, planner, workers and reviewer each run on their own model.
- One app-wide cap on workers (1 to 100, set in Settings › Agents). Plans with a higher priority get the next free slot.
- Wave replanning, a reviewer on every Task (up to 5 rounds) and a final check against the goal.
- Pause or stop a plan or one worker. Rename, archive and unarchive plans. Queue a plan behind another.
- Per plan, in its own tab: goal, steps, and Log, Changes (who wrote each line, agent or human), Files and "Talk to the plan".
- **Change a running plan** in the plan tab's **Plan settings** (also **Edit plan settings…** in the Plans view's context
  menu): workers at once, priority, review rounds, planning again between steps, auto-approve, hands-off and delivery.
  Changes save as you make them and apply to agents that start from then on.
- Usage guards: no new worker starts on an account near its limit (90% by default); it starts on the next account.

**Agents and Needs you.**
- The Agents view lists the project's consoles by state (Needs you, Working, Finished). Click one to open it in its own
  tab and type into it. While you type, the coordinator's messages to that console wait. A finished console leaves a
  short summary card of what it did.
- The bottom panel (`Ctrl+J`) has **Needs you · Activity · Output · Terminal** tabs. Agents can never approve a plan or
  answer a permission prompt. Only you can.

**Source Control and Explorer.**
- One git worktree per worker, under `~/astera-worktrees/<repo>/`. Astera merges finished Tasks itself and cleans up
  the worktrees of a delivered plan.
- Source Control lists the worktrees and their changes. The Explorer view has the file tree, an editor, side-by-side markdown, and local history before every delete.
- GitHub: issues and pull requests linked to plans and Tasks.

**Accounts and windows.**
- Several accounts per vendor, each isolated in its own `CLAUDE_CONFIG_DIR` / `CODEX_HOME`.
- **Account rolling:** when a session hits a usage limit, Astera reads the reset time and resumes the work on the
  next account.
- One window per project, side by side. The Host owns every session, so closing a window stops nothing.

**Reach it from anywhere.**
- The `astera` command, an MCP server and a TypeScript SDK all drive the same Host.
- Plugins run beside the Host as job sources and notifiers ([docs/plugins.md](docs/plugins.md)).
- **Remote runtimes**: run sessions and plans on another machine over your own LAN, VPN or Tailscale. The remote
  Runtime owns the agents, worktrees, checks and recovery, so work keeps going while your client is away.
  No Astera relay or cloud service is required. See [docs/remote-runtime.md](docs/remote-runtime.md).

**Safe by default.**
- Auto-update and the remote policy are off unless built with `ASTERA_AUTO_UPDATE=1`.
- Agents ask before every permission prompt, and the bypass is off unless you turn it on.

## Architecture

<div align="center">
<img src="assets/docs/diagrams/architecture.svg" width="860" alt="Astera's architecture: the app window, the Host, the CLI, MCP and SDK clients, agent terminals, worktrees and git or GitHub" />
</div>

The Host owns every session, worktree and plan. The app window, the `astera` command, the MCP server and the SDK are
clients of that one Host. See [docs/architecture.md](docs/architecture.md).

## The `astera` command

It talks to the Host, so it works with the app open or closed:

```bash
astera projects add --path ~/code/app                            # a git repository becomes a project
astera jobs create --objective "…" --cwd ~/code/app --attach plan.md
astera jobs plan --id <jobId>                                    # the planner writes the Tasks
astera jobs run --id <jobId>                                     # approve and start
astera questions list --status open                              # what is waiting on you
```

Everything else is in [docs/cli.md](docs/cli.md).

## Where it is going

Still ahead: **Run as written by name**, so you write the prompt names in the Start box and Astera finds the files
instead of you attaching them. The decided plans and the contracts are in [docs/dev/PLAN.md](docs/dev/PLAN.md).

## Documentation

| | |
|---|---|
| **Start here** | [Docs hub](docs/README.md) · [Getting started](docs/getting-started.md) · [Concepts](docs/concepts.md) · [Architecture](docs/architecture.md) |
| **Use** | [User guide](docs/guide.md) · [Everyday usage](docs/usage-guide.md) · [Jobs](docs/jobs.md) · [Troubleshooting](docs/troubleshooting.md) |
| **Build on it** | [`astera` command](docs/cli.md) · [MCP](docs/mcp.md) · [SDK](docs/sdk.md) · [Plugins](docs/plugins.md) |
| **Run it elsewhere** | [Remote runtimes](docs/remote-runtime.md) · [Slack bot](docs/slack-bot-setup.md) · [Telegram bot](docs/telegram-bot-setup.md) |
| **Contribute** | [CONTRIBUTING](.github/CONTRIBUTING.md) · [Plan](docs/dev/PLAN.md) · [Releasing](docs/releasing.md) · [Linux notes](docs/dev/LINUX.md) |

Also: [product docs](docs/product/) (features, known limits, licensing) and [How It Works](docs/how-it-works.md).

## Credits

Astera started as a fork of [parsingk/Astera](https://github.com/parsingk/Astera) and has diverged from it since.
The coordinator-and-workers model takes its cues from [Orca](https://github.com/stablyai/orca)'s agent
orchestration. The implementation is our own.

## License

[Apache License 2.0](LICENSE).
