<div align="center">

<img src="assets/banner.jpg" width="640" alt="Astera — build beyond the stars" />

**Keep Claude Code and Codex working while you are away.**

**Guide: [astera.run](https://astera.run)**

[![License](https://img.shields.io/github/license/parsingk/Astera?color=blue)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Linux%20first-555)

[Status](#where-the-fork-stands) · [What's left](#whats-left) · [Run it](#run-it-locally) · [What the fork adds](#what-this-fork-adds) · [Upstream features](#what-it-does) · [Documentation](#documentation)

**English** · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) (the translations are upstream's and have no fork section)

<img src="assets/hero.jpg" width="960" alt="Astera running four sessions in one window as a 2x2 grid — three Claude Code and one Codex, on two Claude accounts and a Codex one — with the accounts and the project history in the sidebar" />

</div>

> **This is a private fork:** [JanoTheDev/astera-orchestrator](https://github.com/JanoTheDev/astera-orchestrator),
> built on [parsingk/Astera](https://github.com/parsingk/Astera). It turns Astera's Jobs into an orchestrator.
> You talk to a cheap coordinator. A premium planner splits the work into tasks with prompts. You approve the
> plan, and workers run the tasks in parallel, in dependency order, on the right model. Each plan ends as one PR.
> The requirements are in [SPEC.md](docs/orchestrator/SPEC.md), the plan is in [PLAN.md](docs/orchestrator/PLAN.md),
> and Linux facts are in [LINUX.md](docs/orchestrator/LINUX.md).

## Where the fork stands

Status on 2026-10-17. The work runs in waves of parallel PRs. Each wave is merged with
[MERGE.md](docs/orchestrator/prompts/MERGE.md) before the next wave starts.

| Wave | Item | PR | State |
|---|---|---|---|
| 0 | Linux baseline + security hardening | #25 | Merged |
| 1 | W1-A Per-role models (coordinator, planner, worker, reviewer) | #26 | Merged |
| 1 | W1-B App-wide worker cap + Job priority | #29 | Merged |
| 1 | W1-C Plan lifecycle: title, rename, archive, unarchive | #28 | Merged |
| 1 | W1-D Linux: orchestration survives closing the window | #27 | Merged |
| 2 | W2-A Plan-only planner stage, Approve & execute | #33 | Merged |
| 2 | W2-D GitHub task links (issue, branch, commits, PR), one PR per plan | #30 | Open. Merge into `main` in progress locally |
| 2 | W2-C Plan overview + task board with why-is-it-waiting reasons | #31 | Open |
| 2 | W2-B Workspace sidebar (Project → Plan → sessions) | #32 | Open |
| 3 | W3-A Activity feed, summaries, throttled notifications | — | Not started |
| 3 | W3-B Command bar + push-to-talk voice (local whisper.cpp) | — | Not started |
| 3 | W3-C Cross-project search + "needs my input" inbox | — | Not started |
| 3 | W3-D Routing and recovery tests | — | Not started |
| 4 | Final Linux verification | — | Not started |

## What's left

1. **Finish Wave 2.** Merge #30, #31 and #32 into `main`, run the typecheck and the full suite, and push.
2. **Wave 3.** Run the four W3 prompts in [docs/orchestrator/prompts/](docs/orchestrator/prompts/) in parallel,
   then merge them.
3. **Wave 4.** Verify the whole flow by hand on Linux, and update [LINUX.md](docs/orchestrator/LINUX.md).
4. **Later.**
   - Codex accounts. For now only Claude accounts are set up, so review falls back to Claude on a stronger model.
   - Moving the per-session command scheduler into the Host, so it keeps running with the window closed.

Known Linux issues are listed in [LINUX.md](docs/orchestrator/LINUX.md#known-issues--gaps-not-fixed-in-wave-0).

## Run it locally

You need Node ≥ 22.13, `python3`, `make` and `g++`, because `node-pty` is compiled on install. You also need the
`claude` CLI on your `PATH`, and `gh` for PRs.

```bash
git pull origin main
npm ci                         # also builds node-pty against Electron
npm run dev                    # the dev app; its profile is ~/.config/astera-dev
```

Checks before a PR:

```bash
npm run typecheck
npx vitest run --maxWorkers=2  # never run this at the same time as npm run dev or a build: it crashed the laptop
```

Things to know before you test:

- **Agents stop at permission prompts by default.** Job workers and the coordinator wait for you unless you turn
  on **Settings → Run agents without permission checks**.
- **Closing the window quits the app on Linux, but the Host keeps going.** Jobs, workers and account rolling
  keep running. Choose "End the kept sessions too" in the close dialog to stop them.
- **Auto-update is off.** To take upstream changes, run `git fetch upstream && git merge upstream/main`, then
  rebuild.

## What this fork adds

What's merged into `main` so far:

- **Per-role models.** The coordinator, planner, workers and reviewers each get their own model. They are set
  in **Settings → Orchestration models**, and a Job can override them. Defaults: coordinator haiku, planner and
  reviewer opus. Workers get haiku, sonnet or opus by the task's difficulty.
- **Planner stage.** `jobs plan` starts a planner session that can only plan. It writes each Task's prompt,
  acceptance criteria, affected paths, difficulty and model. In the Jobs view, **Approve & execute** starts the
  workers.
- **Global scheduling.** An app-wide `maxConcurrentWorkers` cap across all plans. `Job.priority` decides who
  gets a free slot first.
- **Plan lifecycle.** `astera jobs rename`, `jobs archive [--kill-sessions]` and `jobs unarchive`, also inline in
  the Jobs view. An archived plan starts no new work.
- **Linux.** Orchestration keeps running in the Host after the window closes. A reattached pane repaints.
- **Security defaults.** Auto-update and the remote policy are off unless built with `ASTERA_AUTO_UPDATE=1`.
  Agents never skip permission checks unless you turn that on. Dependencies are bumped (electron 41.10.7).

---

Everything below is upstream Astera's README, and it still applies to this fork.

## What it does

**Project workspaces**
- Multiple `claude` / `codex` sessions, worked on across split panes
- A terminal per project

**Conversation view**
- A session opens either as a terminal or as an ordinary chat interface. Which one is settled when
  the session is made and does not change afterwards. What a new session opens as is set in
  **Settings → General**
- A chat session's questions and approvals arrive as cards. Its model and permission mode are picked
  beside the composer
- Drop a file or paste an image and its path goes into the message

<div align="center">
<img src="assets/conversation.jpg" width="820" alt="The same four sessions read as chat threads in a 2x2 grid — three Claude Code and one Codex, on two Claude accounts and a Codex one, each pane with its own composer, model and reasoning effort, and the accounts and project history in the sidebar" />
</div>

**Accounts**
- Several accounts per vendor, each isolated through its own `CLAUDE_CONFIG_DIR` / `CODEX_HOME`
- **Account rolling:** when a session hits a usage limit, Astera detects it from the transcript,
  works out the reset time, and resumes the work on the next account
- Optional import of a new account's setup from your default one: `settings.json`, the MCP server
  list, and the `skills`, `commands` and `agents` directories

<div align="center">
<img src="assets/rolling.gif" width="820" alt="Diagram: a running session hits its weekly limit, Astera reads the reset time from the transcript, switches to the next account, and the same conversation carries on" />
<img src="assets/rolling-demo.gif" width="820" alt="Screen recording: a session hits a usage limit, Astera switches to the next account with the same conversation restored, and when there is nowhere left to go it says when it will resume" />
<p><a href="https://github.com/parsingk/Astera/blob/main/assets/astera-demo-rolling.mp4">▶ Full recording (28s)</a></p>
</div>

**Smart Resume**
- Off by default. **Settings → Agents → Session resume strategy** chooses between the CLI's own
  resume and this one
- With it on, a usage limit that moves the work to the next account starts that session **blank** and
  hands it a compact checkpoint as its first message, instead of replaying the whole conversation
- The checkpoint carries the working folder and its git state, the conversation's recent requests in
  order, the files it touched, the last command it ran, and the tail of the exchange — with secrets
  redacted on the way in
- If a checkpoint cannot be built the switch falls back to the ordinary resume, so turning this on
  never leaves a roll worse off than before

**Completion convergence**
- A job's failed builds and tests, and blocking review findings, are sent back to the worker for
  repair and then checked again — until the completion policy passes or the retry limit is reached
- The loop survives account rolling, pauses and app restarts, so a job keeps moving toward
  completion instead of starting over

**Scheduling and remote control**
- Schedule sessions to start at a given time
- Slack notifications when a turn finishes or a limit is hit, and Slack-side replies back into a
  session — so you can keep an eye on a run from your phone

<div align="center">
<img src="assets/schedule.gif" width="820" alt="Diagram: at 03:00 a scheduled session starts on its own, runs the command left for it, finishes, and Slack reports the result" />
<img src="assets/schedule-demo.gif" width="820" alt="Screen recording: a session showing its schedule, and the command going in on its own when the time comes" />
<p><a href="https://github.com/parsingk/Astera/blob/main/assets/astera-demo-schedule.mp4">▶ Full recording (22s)</a></p>
</div>

**The `astera` command**
- Read and drive Jobs from a terminal, a CI pipeline or an agent: `astera jobs run`,
  `astera runs wait`, `astera questions answer`. Every session Astera starts already has it
- It keeps answering after you quit the app, because a background Host owns the work and outlives
  the window. Workers keep running too, and you can start sessions and Jobs with the app closed (see
  [Using Astera from a terminal](#using-astera-from-a-terminal-with-the-app-closed))
- JSON by default and `--human` for reading, one meaning per exit code, and command lines to run
  next on every error. See [the `astera` command](docs/cli.md)

**Run**
- A run configuration has a kind — Shell, npm, Node.js, Gradle, Maven, cargo, go, Python, pytest,
  Docker Compose, Dockerfile, .NET or Compound — and holds only the fields that kind actually has
- The command is assembled when you run it, so the Gradle wrapper, the package manager your lockfile
  implies and the quoting your shell needs are worked out then, not typed into a box
- Your build files are read, so a project's npm scripts are already there as configurations, and a
  Gradle or Maven project starts with the standard tasks and goals. A detected one shows in italics
  until you edit it, which saves it as yours

**GitHub**
- Pull request state is shown in the worktree list
- A worktree holding commits its base does not have offers to create the pull request — one dialog
  pushes the branch and opens the PR against the branch that worktree was forked from
- It borrows the `gh` login you already have; no token is stored

**How It Works**

Understand a finished change without reading every file. Open a work record to see what it does,
what users will notice, its flow, the reasons behind it, and the files that implement it.

- How It Works is for people who do not read code. Write down what you want done with the
  `/astera-task` skill and it starts getting ready to record from there; once the work is finished it
  reads what happened and writes it up
- `/astera-task` is a skill the app installs into your accounts, like the orchestration one. It
  tells the agent to mark the start, keep working through as many of your messages as it takes, and
  mark the end when your objective is met — you type the objective, it does the rest
- Claude Code's and Codex's own `/goal` is recorded the same way. On Claude the record completes
  itself once the work is done; on Codex you have to complete it yourself
- Only one piece of work can be recorded per session. A request that arrives while one is already
  being recorded asks you to complete the earlier one first, and the next one starts once you do
- A Jobs Run (`/astera-orchestration`) is read and recorded the same way. The reading starts once
  the Run has finished
- A piece of work that changed no files leaves no row. If you declared one and then only talked,
  there is nothing to write up
- Off by default. Turn on **Work unit tracking** in **Settings → How It Works**, then pick the
  **Explanation account** that will write the entries. It does not apply to sessions that are
  already open — only new sessions get it
- Only work done after you turned the feature on in settings is recorded

<div align="center">
<img src="assets/how-it-works-demo.gif" width="820" alt="How It Works walkthrough: follow a task in progress, read its completed explanation and flow diagram, then select a step to see its reasoning and implementation files" />
<p>From work in progress to a readable explanation. Select a flow step to see what happens there and which files implement it.</p>
</div>

This 14-second walkthrough uses example data rendered with Astera's actual How It Works components
in the Umbra theme. The explanatory header belongs to the walkthrough, not the app UI.

To try it:

1. In **Settings → How It Works**, enable **Work unit tracking** and choose an **Explanation account**.
2. Open a **new session** in a git project and send `/astera-task` followed by your objective.
3. Once the work finishes, open **How It Works** (`Ctrl`/`Cmd`+`Shift`+`H`) and select its record.
4. Read the explanation, then select a flow step to narrow the reasoning and implementation list.

See the [How It Works guide](docs/how-it-works.md) for record states, verification labels, and
what to check when an explanation is missing.

**Design Mode**
- Turn on **Design Mode** on the web page tab and pick elements on the page. Hovering highlights one;
  clicking pins a numbered badge to it and opens a note beside it. Answer "What should change?" and
  mark the intent **Change** or **Question**
- Up to twenty notes per tab, and numbers are never reassigned.
- **Send to session** pastes every note as one markdown block into the session you choose.
- Each note carries the element's selector, position, styles and HTML, its nearby text with secrets
  redacted, and the path of a screenshot cropped to that element. The agent looks at the element
  instead of reading a description of it
- Design Mode turns itself off when the page navigates away.

**Agent browser**
- The session's agent gets a web page tab of its own and drives it itself. It opens a page on the dev
  server, reloads it after a change, reads its address and title, and reads back what the console and
  the network reported since that load.
- "Does the page still render, and is the console clean" becomes something the agent can answer by
  looking, instead of something it asks you to check.
- The agent's web page tab takes `localhost`, `127.x`, `[::1]`, `*.localhost` and the two wildcard
  addresses; anything else is refused, and so is a link on the page, or a redirect from the dev server,
  that would leave
- The tab closes with its session
- It reads the page as text (a snapshot) and looks at it as an image (a screenshot), clicks elements, fills values, presses keys and waits
- Off by default. Turn on **Agent browser** in settings and it installs the `astera-browser` skill
  into your accounts, the way the other two features install theirs. It does not apply to sessions
  that are already open. Only new sessions get it

**Editor and shortcuts**
- One key shows and hides the explorer — `Ctrl`/`Cmd`+`Shift`+`E` for the file tree, the run toolbar
  and the run console, leaving the panes where they are
- The other two sidebar views have a key each — `Ctrl`/`Cmd`+`Shift`+`J` for Jobs and
  `Ctrl`/`Cmd`+`Shift`+`H` for How It Works
- One tab bar per pane, holding both kinds of tab: a file sits beside the session that is changing
  it, a split shows the two at once, and `Ctrl`+`Tab` walks the active pane's row
- A real editor, not a text box: CodeMirror with syntax highlighting for TypeScript, JavaScript,
  Python, Go, Rust, C/C++, Java, PHP, SQL, HTML, CSS, Markdown, JSON, YAML and XML, open across tabs
- **Markdown side by side:** a markdown file opens as editor, split, or preview, and
  `Ctrl`/`Cmd`+`Shift`+`V` cycles the three — in split, the two panes follow each other's scrolling
- A file tree with git state on each entry (new, modified, deleted, conflict), and create, rename,
  move, copy, delete and reveal-in-Finder/Explorer
- **Local history:** a snapshot is taken before a delete, so an agent's cleanup — or your own — is
  recoverable. Kept 30 days, up to 200 MB per project
- Every shortcut is remappable in settings, defaulting to `Cmd` on macOS and `Ctrl` elsewhere:
  splitting panes, moving focus between them, cycling sessions, closing a file tab, opening a
  sidebar view

**Appearance**
- Seven themes — Vega, Orion, Umbra, Aurora, Antares, Quasar and Sirius — picked from cards that each draw
  themselves in their own palette, so you choose by looking rather than by name
- A theme is more than colours: the corner radius, the shadows, the UI typeface and the row density
  come with it, so Quasar puts more on screen than Umbra does
- Switching one changes what is already open — a running terminal's colours are swapped in place, so
  it keeps its scrollback
- The terminal font is chosen separately, including the fallback for CJK text

**Remote runtimes**
Run Astera Sessions and Jobs on another machine over your own LAN, VPN, or Tailscale connection. The remote Runtime owns the agents, worktrees, checks, and recovery, so work keeps going even if your client disconnects. No Astera relay or cloud service is required. See [docs/remote-runtime.md](docs/remote-runtime.md).

**Also**
- Korean, English, Japanese, and Spanish UI, plus a System option that follows the OS locale
- Auto-update from GitHub Releases

## Jobs

Jobs is always there — the Jobs sidebar is part of the app, with nothing to switch on. A job is a
dependency graph whose tasks can run under either vendor, and there are three ways to run one.

<div align="center">
<img src="assets/jobs.gif" width="820" alt="Diagram: a coordinator follows a job's dependency graph, starts the two ready tasks on both vendors at once, uses a test suite to prove one done, waits for both dependencies before continuing, and leaves an unresolved decision for a person" />
<img src="assets/jobs-demo.gif" width="820" alt="Screen recording: a job advancing through its dependency graph — a worker hits a usage limit and resumes by itself, both dependencies report, and the last task passes a validation and a cross-vendor review" />
<p>Recorded example: follow task dependencies, worker progress, usage-limit recovery, validation, and cross-vendor review in the Jobs view.</p>
<p><a href="https://github.com/parsingk/Astera/blob/main/assets/astera-killer-demo.mp4">▶ Full recording (30s)</a></p>
</div>

### 1. Build it in the Jobs sidebar

1. Make sure the project is a git repository with a branch checked out.
2. Click **New job**, enter the **Objective**, choose a **Coordinator account**, set **Run at once**,
   and optionally add a schedule.
3. Add tasks with instructions, one or more worker accounts, and any dependencies. Attach builds,
   tests and cross-vendor reviews as completion checks. With **Auto-fix until the checks pass** on,
   a failed check or a blocking review finding is sent back to the worker for repair and verified
   again, until the completion policy passes or the retry limit is reached.
4. Click **Run**. A normal job opens its coordinator; a scheduled job activates its schedule.

The Jobs view shows the dependency graph, active workers, questions and timeline. Parallel tasks can
use separate git worktrees, and the finished result stays out of your checked-out branch until you
click **Merge**. See the [complete Job lifecycle](docs/jobs.md) for details.

### 2. Run it with the `astera-orchestration` skill — an agent coordinates

Every session Astera starts receives the `astera` CLI on its `PATH` and the `astera-orchestration`
skill. You can ask naturally:

> Use the `astera-orchestration` skill to coordinate this work: refactor the authentication module,
> add regression tests after the refactor, and verify the test suite.

The skill can also be invoked explicitly as `/astera-orchestration`. It is for multi-step work that
needs supervision, completion tracking or dependency coordination. The coordinator creates the run
and tasks, dispatches Claude and Codex workers, waits for their reports and brings questions back to
you. Runs created this way also appear in the Jobs sidebar when they belong to the open project, and
with **Work unit tracking** on they land in How It Works as one row each when they finish, exactly
like a Run you started yourself.

Skills are loaded when a session starts, so a session that was already open before an upgrade does
not have them — open a new coordinator session. A simple one-off handoff does not need an
orchestration run.

To read the coordinator CLI reference:

```bash
astera help
```

If `astera` is not on `PATH`, use the path in the `ASTERA_CLI` environment variable (`"$ASTERA_CLI"` in
bash or zsh, `$env:ASTERA_CLI` in PowerShell). An empty value means the session was not started by
Astera: every session it starts gets the CLI.

### 3. Drive it from a terminal, a script or an agent with the `astera` command

The same Jobs can be listed, started, waited on and answered from an ordinary terminal, a CI pipeline
or an agent. Install the command once from **Settings → CLI**. Sessions
Astera starts already have it, so the agent in any of them can call the same commands. The command
keeps answering after you quit the app, because the **Astera Host**, the background process that owns
the work, outlives the window. `astera host start` brings one up if none is running.

```bash
astera --help                     # usage for every command (astera help, no dashes, is the agents' guide)
astera jobs list --human          # readable columns instead of JSON
run=$(astera jobs run --id job_123 | jq -r '.data.id')
astera runs wait --id "$run"      # 0 done, 8 a person is needed, 10 failed, 7 deadline passed
astera questions answer --id <questionId> --answer "use the existing migration"
```

Each exit code has one meaning, so a pipeline can tell a run that finished badly (10) from one waiting
for a person (8). See [the `astera` command](docs/cli.md) for every command, the JSON format, exit
codes, retrying a call safely, CI recipes and security notes.

**MCP**
Let MCP-capable agents create, run, and monitor Astera Jobs through the same local Host used by the desktop app and CLI. See [docs/mcp.md](docs/mcp.md).

## Using Astera from a terminal, with the app closed

The `astera` command talks to the **Astera Host**, the background process that runs your sessions and
Jobs. The Host keeps running after you quit the app, so from PowerShell, cmd or any shell you can:

- start agent sessions, see what they show, and type into them
- create Jobs, add their tasks, run them, wait for them and answer their questions
- let workers run and move to another account at a usage limit, as they do with the app open

**Once, with the app:**

1. Install Astera, open it, and add your accounts.
2. **Settings → CLI → Install the astera command.** On Windows it
   puts the folder on your user `PATH` too (a checkbox, on by default). On macOS and Linux, if the
   folder is not on your `PATH`, run the line the panel shows.
3. Open a new shell and check it with `astera version`.

**Then, with the app closed:**

```bash
astera host start                                    # starts the Host if it is not running
astera accounts list --human                         # the account ids
astera sessions create --account <id> --cwd <folder> --prompt "fix the failing test"
astera sessions list --human
astera sessions read --id <sessionId>                # what the session's screen shows
astera sessions send --id <sessionId> --text "yes"
astera jobs create --objective "…" --cwd <folder> --coordinator-account <id>
astera tasks add --job <jobId> --spec "…" --account <id>
astera jobs run --id <jobId>
astera runs wait --id <runId>
```

After an update that changes how the app and the Host talk, the Host from before the update cannot
stay: opening Astera replaces it, or run `astera host start --replace`. The sessions that Host was
running end with it. See [the `astera` command](docs/cli.md) for everything else.

## Install

> **This fork publishes no releases.** Build it from source ([Run it locally](#run-it-locally)). The
> text below is about upstream's releases.

Download the latest release from
**[Releases](https://github.com/parsingk/Astera/releases/latest)** and run it — `astera-<version>-setup.exe`
on Windows, `astera-<version>-universal.dmg` on macOS, and `astera-<version>-x86_64.AppImage` or
`astera-<version>-amd64.deb` on Linux. On Windows the app updates itself from there afterwards,
asking before it downloads.

> **macOS builds are not notarized yet**, which costs you two things. Gatekeeper blocks the first
> launch, so after dragging the app to Applications, clear the quarantine flag macOS put on it:
>
> ```bash
> xattr -cr /Applications/Astera.app
> ```
>
> That removes the "downloaded from the internet" marker, which is the only thing standing in the way
> — the app itself is signed (ad-hoc), so nothing else about it changes. System Settings →
> **Privacy & Security** → **Open Anyway** works too if you prefer clicking; the Control-click →
> **Open** shortcut does not, macOS 15 (Sequoia) removed it.
>
> And auto-update stays off until the build is notarized, so a new version means downloading the dmg
> again. On Windows, SmartScreen may warn on first run — click **More info → Run anyway**.
>
> Signing through the SignPath Foundation's open-source program (Windows) and an Apple Developer ID
> (macOS) is being set up — see the [Code signing policy](docs/code-signing.md) for who signs what,
> and [docs/releasing.md](docs/releasing.md) for the mechanics. The Linux builds are unsigned, which
> is what that channel expects.

> **On Linux**, neither artifact runs straight from the download. Give the AppImage the executable
> bit:
>
> ```bash
> chmod +x astera-<version>-x86_64.AppImage
> ```
>
> and install the deb through apt rather than `dpkg -i`, so its dependencies come with it:
>
> ```bash
> sudo apt install ./astera-<version>-amd64.deb
> ```
>
> The deb declares the supported floor, so apt refuses an older system instead of installing
> something that cannot start.

You will also need:

- **Windows 10 or 11**, **macOS 12 (Monterey) or later**, or **Ubuntu 22.04 / Debian 12 or later**
- **[Claude Code](https://claude.com/claude-code) and/or the Codex CLI** on your `PATH` — Astera runs
  them, it does not replace them

## Build from source

Building needs **Node.js 22.13+**, and a C++ toolchain for `node-pty`'s native rebuild (via
`electron-builder install-app-deps`): the **Visual Studio Build Tools (C++)** on Windows, the
**Xcode Command Line Tools** (`xcode-select --install`) on macOS, or **build-essential** and
**python3** on Linux, where node-pty ships no prebuild and is always compiled.

```bash
npm ci
npm run dev        # run in development
npm run typecheck  # tsc over both the node and web projects
npm run build      # bundle
npm run dist       # package for the current platform into dist-installer/
npm run dist:win   # Windows installer
npm run dist:mac   # macOS universal dmg + zip
npm run dist:linux # Linux AppImage + deb
```

`npm run dist` reads the committed icon assets (`build/icon.ico` on Windows, `build/icon.icns` on
macOS, and the shared `resources/tray.png` on both) rather than generating them. If you change the logo, replace
`resources/logo-source.png` and re-run the matching script on its own platform — `powershell -File
scripts/gen-icon.ps1` (ico/png) on Windows, `sh scripts/gen-icon-mac.sh` (icns) on
macOS — then commit the regenerated assets.

Tests are colocated as `*.test.ts` and run with `npm test` (Vitest). CI runs the typecheck, the suite,
and a full bundle build.

## Documentation

- [Orchestrator plan](docs/orchestrator/PLAN.md), [spec](docs/orchestrator/SPEC.md), [context](docs/orchestrator/CONTEXT.md), [security audit](docs/orchestrator/SECURITY-AUDIT.md) and [wave prompts](docs/orchestrator/prompts/README.md) — this fork's work
- [Linux](docs/orchestrator/LINUX.md) — prerequisites, commands, what is verified, known issues
- [Everyday usage guide](docs/usage-guide.md) — sessions, accounts, scheduling, files, previews, recovery, and settings
- [How It Works](docs/how-it-works.md) — record a task, read its explanation, and follow the implementation
- [Job lifecycle](docs/jobs.md) — tasks, worktrees, completion, merging, and scheduled runs
- [The `astera` command](docs/cli.md) — driving Jobs from a shell or CI: install, commands, JSON, exit codes
- [MCP](docs/mcp.md) — letting an MCP client create, run, and monitor Jobs: connecting, the tools, and MCP access
- [The SDK](docs/sdk.md) — the TypeScript client for building integrations on the Host: Jobs, Runs, questions, and events
- [Plugins](docs/plugins.md) — writing, installing, and debugging the programs Astera runs beside its Host
- [Slack bot setup](docs/slack-bot-setup.md) — creating the app, tokens, and permissions
- [Releasing](docs/releasing.md) — how a version gets cut and published
- [Code signing policy](docs/code-signing.md) — who signs the releases, what is signed, and privacy

## Contributing

Issues and pull requests are welcome. A couple of things worth knowing before you start:

- Run `npm run typecheck`, `npm test` and `npm run build` before opening a PR — that is what CI checks.
- A change to behaviour is expected to come with a test. One rule worth knowing before you touch the
  rolling tests: the usage-limit phrases are split with `+` on purpose, because Astera watches session
  output for them — see [CONTRIBUTING](.github/CONTRIBUTING.md).
- New here? [CONTRIBUTING](.github/CONTRIBUTING.md) starts with setting up, where things live and
  what to pick up first. Report bugs with the form in
  [Issues](https://github.com/parsingk/Astera/issues/new/choose), and security problems privately as
  [SECURITY.md](.github/SECURITY.md) says.

## Acknowledgements

- The cross-vendor orchestration model — a coordinator dispatching tasks to worker sessions through a
  local CLI, blocking questions, and ownership checks — takes its cues from
  [Orca](https://github.com/stablyai/orca)'s agent orchestration. The implementation here is our own.
- The Windows code-signing pipeline follows the fail-open SignPath flow Orca uses for its releases —
  see [docs/releasing.md](docs/releasing.md).
- macOS releases are meant to be signed and notarized with an Apple Developer ID, and the workflow is
  ready for it. Unlike the Windows path, this one is not optional: without it, `electron-updater`'s
  macOS auto-update (built on Squirrel.Mac) refuses to install updates at all — so until the
  certificate is in place, builds ship ad-hoc signed and do not auto-update.

## License

[Apache License 2.0](LICENSE).
