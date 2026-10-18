# Using the orchestrator

The day-to-day guide. A **project** is a git folder, a **plan** is a Job, a **Task** is one unit of work, and each
attempt at a Task is one real `claude` (or `codex`) terminal session, a **worker**. The background **Host** process
owns every session and drives every plan, so closing the window stops nothing (LINUX.md, "Closing the window").

## Before the first plan

- Sign in an account (Accounts panel, "+").
- Settings → Orchestration models: the model of each role. Defaults: planner and reviewer `opus`, coordinator `haiku`,
  workers by Task difficulty (light → haiku, standard → sonnet, hard → opus). Empty means the CLI's default model.
- Settings → "Max workers across all jobs": the app-wide cap. Empty means no limit. At the cap, plans with a higher
  priority get the next free slot.
- Settings → Agents → "Run agents without permission checks" is **off**. Planners, coordinators and workers then stop at
  every Claude permission prompt until you answer it. They show up in the needs-input badge (below).
- Set a git identity (`git config --global user.name …` / `user.email …`). Without one, the merges Astera makes for a
  plan are committed as `Astera <astera@localhost>`.

## Plans

1. **Create.** Jobs view → "+ New job" (pick the project and write the objective), or from a shell:
   `astera jobs create --objective "…" --cwd <repo> --coordinator-account <id>`. Name it with Rename (pencil) or
   `astera jobs rename --id <job> --title <name>`. The name is what the sidebar, search and the command bar use.
2. **Plan.** `astera jobs plan --id <job>`, or "Plan …" in the command bar, starts the **planner**: a session on the
   planner model that reads the repo and its CLAUDE.md and writes the plan as Tasks. Each Task gets a prompt,
   acceptance criteria, affected paths, a difficulty and the reason for its model, plus its dependencies. The planner
   cannot start work. The plan is also written to `plans/<job>/plan.md` in the profile.
3. **Approve.** Read the Tasks (Jobs view → Details, or the Board), then press **Approve & execute** and confirm. Astera
   refuses a plan in which a Task lacks a prompt or a criterion, a dependency is missing, or the dependencies form a
   cycle, and lists what is wrong. From a shell, `astera jobs run --id <job>` does the same. An agent session can never
   approve. Approval ends the planner session: its work is done.
4. **Run.** A coordinator session (coordinator model) starts and places workers. Every Task whose dependencies are done
   gets a worker in its own worktree under `~/astera-worktrees/<repo>/`. Dependents start on their own when their
   dependencies complete, never before. "Done" is the worker's explicit report plus any checks, not a quiet terminal.
5. **Hold / stop / resume.** Jobs view → the hand button, or "pause <plan>" / "stop launching for <plan>" in the
   command bar, **holds** a plan: no new worker starts, running workers carry on and nothing is closed, so nothing is
   asked. The play button or "resume <plan>" lets it launch again. "pause worker 2" pauses one worker after a
   confirmation: its session stays open and keeps its slot, and no agent types into it until "resume worker 2".
   "stop <plan>" in the command bar (or `astera runs stop`) **closes** the plan's workers and coordinator, after a confirmation. Resume starts the coordinator again, which places one new worker per
   unfinished Task. A plan without a coordinator puts its stopped Tasks back to ready, and the Host places each once.
6. **Archive.** Jobs view → Archive, or `astera jobs archive --id <job>`. Archiving starts nothing new and leaves sessions
   running unless you add `--kill-sessions`, which ends every session of the plan: its planner, its coordinators and
   its workers, also those that already reported. Unarchive brings the plan back.
7. **Tasks from a shell.** `astera tasks add --job <job> … --difficulty <light|standard|hard>` (or `--model <id>`)
   picks the worker's model as a planner's Task does. Without either, the worker runs on the Job's or the app's worker
   model, or on the CLI's default model when none is set.
   `astera tasks list --run <job>` lists a Job's own Tasks before its first Run.

One PR per plan, opened when the plan finishes, never merged automatically.

## The workspace

The sidebar's **Workspaces** tree is Project → Plan → Planner / Coordinator / Workers. Clicking a session shows its
terminal. The header above it always says Project · Plan · Task · Model · Account · cwd · Branch · Status. Switching
sessions or plans never restarts a process or changes its cwd. Scrollback survives switching and a restart of the app.

- **Type into a worker**: click it in the tree and type. To send one line without switching, use the command bar:
  `send "run the tests" to Gameful Worker 2`.
- **Needs my input**: the number next to Workspaces counts sessions waiting for you (a permission prompt or a
  question). Click it for the list. The Host reads each session's hook events, so a wait that began while the app was
  closed is listed too, with what it waits on ("waits for your permission", "has a question for you").
- **Search**: the box under Workspaces matches sessions, plans and Tasks across projects, also by initials:
  `hw1` finds "Hold Worker 1". Each hit shows "project › plan · task".
- **Board**: the Run window's board shows every Task, and for each one that is not running, why ("waits for A",
  "App-wide limit full", "Its worker was stopped").

## Activity feed

The **Activity** panel under Workspaces is the feed of the open plan. "All plans" switches it to every plan. Each line
says what happened ("completed", "failed", "cancelled", "worker stopped by you", "hit a limit on <account>, waiting for
the reset", "waiting for your permission", "plan ready for your approval", "plan done"), with the plan, the model and the account. "Last 15 min" groups
the recent lines by outcome and lists each blocked Task with its reason. The Host keeps the feed in
`<profile>/orch/activity.jsonl`, so it survives a restart of the app. "Plan ready for your approval" comes when the
planner ends its turn on a plan that holds, once per plan. The feed and its summary also show the lines of every paired
Runtime, marked "on <runtime>".

## Notifications and the digest

- Settings → Notifications → **Orchestration updates**: desktop notices for a failed Task, a finished plan, a question
  and a plan awaiting approval. At most three a minute. The rest are counted in the next digest.
- Settings → **Activity summary every (minutes)**: the digest, default 30, sent only when something happened. 0 turns
  it off; held notices are then announced once a minute as "More orchestration updates".
- Slack gets the same notices, from whichever process keeps Slack (the Host, or the app), never from both.
- Desktop notices need the app open. The Host keeps the feed while the app is closed, and you read it when you return.

## Command bar and voice (W3-B)

The command bar is a conversation with the **coordinator**. Open it with **Ctrl+Shift+K**
(rebind it in Settings → Shortcuts, action "Open the command bar").

Type a command and press Enter. The bar handles it in three steps:

1. **Parse.** Simple phrasings are read without a model (`core/intents/fastPath.ts`). Anything else goes to the
   `coordinator` role model (Settings → Orchestration models, default `haiku`) in one read-only `claude -p` call. The
   planner model is never used for this. The call runs on your default signed-in Claude account (`defaultAccountIdOf`).
2. **Resolve.** Names like "Gameful Trading", "worker three" or "the API worker" are matched to exact plan and
   session ids from the workspace sidebar's data. If a name matches more than one thing, or nothing, the bar asks
   which one you mean and shows buttons. It never guesses.
3. **Run.** What runs, and how, depends on the kind of command:

| Kind | Commands | Runs |
|---|---|---|
| read | switch to a plan, show its sessions, summarize, list who is waiting, a plain answer | at once |
| act | plan X, send text to a session, resume, pause / stop launching (a hold: nothing closes) | after you press **Run** (or Enter on an empty line); pausing one worker also asks in the app's dialog |
| confirm | approve and start, stop, archive, delete, merge | only after a click in the app's confirmation dialog |

Voice and typed text never run a confirm-class command on their own.

Examples:

- `Switch to Gameful Trading` / `Show the Value List terminals`
- `What are workers waiting for?` / `Show every session needing my input`
- `Summarize the last 15 min` / `Show progress on Redis`
- `Plan the next Gameful refactor` creates the Job (the "+ New job" form's `run-create --auto`) and starts its
  planner (`jobs plan`). The project is the one named in the sentence, or else the open project.
- `Approve Console` / `Start executing the approved plan` sends `run-start` through the app after you confirm. A plan
  that does not hold together is refused, and the bar lists what is missing (`problems`).
- `send "run the tests" to the API worker` types the text into that one session (`sessions send`).

Limits:

- **Pause and stop-launching hold; stop closes.** On a plain plan, pause and stop-launching hold it (`jobs-hold`):
  no new worker, nothing closed. A **scheduled** plan still pauses as a whole with `run-pause`, which closes its
  sessions and asks first, because a hold does not stop its schedule firing new rounds. "stop <plan>" is `runs-stop`.
- **Pausing a worker** (`worker-hold`) does not interrupt a turn already running, and rolling's resume prompt after a
  usage-limit reset still reaches it. It only keeps agents (the coordinator, an MCP client) from typing into it.
- **Archive and delete** read the plan's counts when asked, for a plan of any project.
- The bar closes with its X button, Escape from anywhere, or a click outside it (not while its confirmation is up).
- **Merge** opens the Run window, where the merge button and its own confirmation are.
- **Summaries** come from task states. W3-A's activity feed is not used here.

### Push-to-talk (local whisper.cpp)

Hold the microphone button in the bar while you talk, then release it. Or press **Ctrl+Shift+M** once to start and
again to send. The transcript goes into the bar like typed text. Read-class commands run at once. Everything else
waits for your click.

Audio never leaves the machine. The renderer records with MediaRecorder and converts the clip to 16 kHz mono WAV.
Main writes the WAV to a private temp folder (mode 700) and runs your whisper.cpp binary on it, then deletes the
clip. Nothing is downloaded automatically. Set it up once:

```bash
sudo apt install build-essential cmake git
git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
cmake -B build && cmake --build build -j --config Release
sh ./models/download-ggml-model.sh base.en      # or small / base for other languages
./build/bin/whisper-cli -m models/ggml-base.en.bin -f samples/jfk.wav   # check that it works
```

Then go to Settings → Voice commands and set both absolute paths:

- **whisper.cpp binary**: `/path/to/whisper.cpp/build/bin/whisper-cli`
- **Model file**: `/path/to/whisper.cpp/models/ggml-base.en.bin`

The app runs `whisper-cli -m <model> -f <clip.wav> -l auto -nt -np` with no shell, and reads stdout as the text. A
clip can be up to 2 minutes long.
