<div align="center">

# Astera

**Hand it a plan. It runs the agents. It asks you only when it must.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Linux%20first-555)

[How it works](#how-it-works) · [Run it](#run-it) · [What it does](#what-it-does) · [The `astera` command](#the-astera-command) · [Docs](#documentation)

<img src="assets/hero.jpg" width="960" alt="Astera running several Claude Code and Codex sessions side by side, with the accounts and the project history in the sidebar" />

</div>

Astera is a desktop app that runs many Claude Code and Codex terminals for you. You give it a goal, an issue or a
folder of written plans. A planner splits the work into Tasks. Workers run them in parallel, each in its own git
worktree and on the model the Task needs. A reviewer checks every Task, and the plan ends as a pull request or a
push. You approve, answer and decide. Everything else runs on its own, also with the window closed.

Every agent is a real `claude` or `codex` terminal, never an imitation of one. You can watch any of them and type
into any of them without stopping the rest.

## How it works

1. **Add a project.** A project is one git repository. Add an existing folder or create a new one, optionally with a
   GitHub repository.
2. **Start a plan.** Write a goal, pick a GitHub issue, or attach your own plan files. Choose the mode:
   - **plan** (default): the planner reads the repository and cuts the goal into Tasks.
   - **audit**: the planner audits a path first, then plans the fixes.
   - **fixlist**: the goal is a problem list, and every problem gets one or more Tasks.
3. **Approve or talk.** Read the Tasks, then press **Approve & execute**. Or tell the planner what to change, and it
   replans. Turn on auto-approve for a project to skip this step.
4. **It runs.** A coordinator places workers as their dependencies finish. Tasks that touch the same files never run
   at the same time. Between waves a fresh planner adjusts what has not started yet to what the finished Tasks did.
   After the last wave it checks the result against the goal and adds follow-ups if something is missing.
5. **It asks you only when it must.** Permission prompts, questions it cannot answer itself and failed reviews go to
   one inbox, with a sound and a desktop notice. Answer there, or type into the agent's terminal directly.
6. **It delivers.** Per project: **pr** opens one pull request per plan and never merges it. **push** merges into the
   delivery branch and pushes it, after the reviews, the final check and the tests pass. It stops and asks when
   anything is off, and never force-pushes.

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
1. **Accounts → +**: add one or more Claude or Codex accounts and sign in.
2. **Settings → Orchestration models**: the model per role. Defaults: planner and reviewer `opus`, coordinator
   `haiku`, workers by Task difficulty (light `haiku`, standard `sonnet`, hard `opus`).
3. **Settings → CLI → Install the astera command**.
4. Set a git identity (`git config --global user.name` / `user.email`).

Agents stop at every permission prompt until you answer it. Turn that off only for repositories you trust:
**Settings → Agents → Run agents without permission checks**.

## What it does

**Hands-off plans**
- Per-role models: coordinator, planner, workers and reviewer each run on their own model.
- One app-wide cap on workers (at most 10). Plans with a higher priority get the next free slot.
- Wave replanning, a reviewer on every Task (up to 5 rounds) and a final check against the goal.
- Hold, resume or stop a plan or one worker. Rename, archive and unarchive plans.
- Usage guards: no new worker starts on an account near its limit (90% by default); it starts on the next account.

**Accounts**
- Several accounts per vendor, each isolated in its own `CLAUDE_CONFIG_DIR` / `CODEX_HOME`.
- **Account rolling:** when a session hits a usage limit, Astera reads the reset time and resumes the work on the
  next account.

**Terminals and workspaces**
- Many `claude` / `codex` sessions in split panes, plus a terminal per project.
- Smart Resume brings sessions back after a restart or crash, and keeps their scrollback.
- The Host owns every session. Closing the window stops nothing.

**Code**
- One git worktree per worker, under `~/astera-worktrees/<repo>/`. Astera merges finished Tasks itself.
- File explorer, editor, side-by-side markdown and local history before every delete.
- GitHub: issues and pull requests linked to plans and Tasks.

**Reach it from anywhere**
- The `astera` command, an MCP server and a TypeScript SDK all drive the same Host.
- Plugins run beside the Host as job sources and notifiers ([docs/plugins.md](docs/plugins.md)).
- **Remote runtimes**: run sessions and plans on another machine over your own LAN, VPN or Tailscale. The remote
  Runtime owns the agents, worktrees, checks and recovery, so work keeps going while your client is away.
  No Astera relay or cloud service is required. See [docs/remote-runtime.md](docs/remote-runtime.md).

**Safe by default**
- Auto-update and the remote policy are off unless built with `ASTERA_AUTO_UPDATE=1`.
- Agents can never approve a plan or answer a permission prompt. Only you can.

## The `astera` command

It talks to the Host, so it works with the app open or closed:

```bash
astera projects add --path ~/code/app                            # a git repository becomes a project
astera jobs create --objective "…" --cwd ~/code/app --attach plan.md
astera jobs plan --id <jobId>                                    # the planner writes the Tasks
astera jobs run --id <jobId>                                     # approve and start
astera questions list --status open                               # what is waiting on you
```

Everything else is in [docs/cli.md](docs/cli.md).

## Where it is going

The roadmap is in [docs/orchestrator/PLAN.md](docs/orchestrator/PLAN.md). Next up:
- Astera builds its own remaining waves from dropped prompt files, one plan after another.
- Plans stay apart: two plans in one project never edit the same files at the same time.
- A redesign: every agent terminal on one screen, a summary per finished terminal, a Tasks board, a worktree viewer
  and one window per project.

## Documentation

- [Orchestrator guide](docs/orchestrator/USAGE.md): projects, plans, approval, the inbox, delivery.
- [Linux](docs/orchestrator/LINUX.md): prerequisites, what is verified, known issues.
- [Everyday usage](docs/usage-guide.md): sessions, accounts, files, recovery and settings.
- [Job lifecycle](docs/jobs.md): Tasks, worktrees, completion and merging.
- [The `astera` command](docs/cli.md), [MCP](docs/mcp.md), [SDK](docs/sdk.md), [Plugins](docs/plugins.md).
- [Remote runtimes](docs/remote-runtime.md), [Slack bot](docs/slack-bot-setup.md).
- For contributors: [plan](docs/orchestrator/PLAN.md), [spec](docs/orchestrator/SPEC.md),
  [context](docs/orchestrator/CONTEXT.md), [wave prompts](docs/orchestrator/prompts/README.md),
  [CONTRIBUTING](.github/CONTRIBUTING.md).

## Credits

Astera started as a fork of [parsingk/Astera](https://github.com/parsingk/Astera) and has diverged from it since.
The coordinator-and-workers model takes its cues from [Orca](https://github.com/stablyai/orca)'s agent
orchestration. The implementation is our own.

## License

[Apache License 2.0](LICENSE).
