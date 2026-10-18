# Using the orchestrator

The day-to-day guide. A **project** is a git folder, a **plan** is a Job, a **Task** is one unit of work, and each
attempt at a Task is one real `claude` (or `codex`) terminal session, a **worker**. The background **Host** process
owns every session and drives every plan, so closing the window stops nothing (LINUX.md, "Closing the window").

## Before the first plan

- Sign in an account: Accounts panel → **+** → pick Claude or Codex and a name → **Add account**. Astera runs the CLI's
  own login for the new account's folder (`claude auth login` / `codex login`) and shows the sign-in link in a small
  dialog with **Open in browser** and **Copy**. Sign in in the browser; if it shows a code, paste it into the dialog's
  code box. The dialog closes by itself once the account reads as logged in. A row that is not logged in has a
  **Sign in** button that does the same. Hover a row for **×** (Remove): the same unregister flow as Settings →
  Accounts, with "Also log out". Double-click an account's name to rename it (Enter saves, Escape cancels). The link
  is held only in memory, never logged or stored.
- If you re-log an account's folder as someone else (`claude /login` in `~/.claude`), the row follows at the next
  login check (when the window gets focus): its label becomes the new email, unless you renamed the account, and the
  old person's usage reading is dropped. A folder re-logged before this check existed is caught at its first check when
  its label is still an email address.
- Settings → Orchestration models: the model of each role. Defaults: planner and reviewer `opus`, coordinator `haiku`,
  workers by Task difficulty (light → haiku, standard → sonnet, hard → opus). Empty means the CLI's default model.
- Settings → "Max workers across all jobs": the app-wide cap, at most 10. Empty means 10. At the cap, plans with a higher
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

### Talk to the planner (W7-A)

- **Request changes.** On a plan waiting for approval, type what to change in the "Request changes" box and send it. The
  text goes to the same planner session; if that session has ended, its conversation is resumed, or else a fresh planner
  starts with plan.md, existing.md and the history. You approve again when it is done.
- **Reject.** The Reject button (asks first, with an optional reason) archives the plan and ends its planner.
  `astera jobs unarchive --id <job>` takes it back.
- **While the plan runs.** The same box starts a replan at once. It changes only Tasks that have not started, and no new
  worker starts until it is done.
- **Auto-approve.** `astera projects set --id <project> --auto-approve on` approves a project's plans as soon as their
  planner finishes, with no one asked. One plan overrides it: `astera jobs plan --id <job> --auto-approve on|off`.
  Default off.
- **Command bar.** `change the plan: split the API task`, `tell the planner to add a migration step`,
  `plan feedback: …` (act: press Run); `reject the plan`, `reject Console because it is too wide` (confirm: asks in the
  app's dialog).
- **CLI.** `astera jobs feedback --job <job> --text <text|->` (`-` reads stdin) and
  `astera jobs reject --job <job> [--reason <text>]`. Both are refused from an agent session.
4. **Run.** A coordinator session (coordinator model) starts and places workers. Every Task whose dependencies are done
   gets a worker in its own worktree under `~/astera-worktrees/<repo>/`. Dependents start on their own when their
   dependencies complete, never before. "Done" is the worker's explicit report plus any checks, not a quiet terminal.
   **Waves and replanning** (a planned Job, on by default): a Task's wave is its dependency depth, and a wave starts
   only when every earlier one has completed. At each boundary the plan is held and a fresh planner adjusts the Tasks
   that have not started to what the done ones reported, reviewed and changed. It may add or cancel Tasks, never
   touch a running or completed one. After the last wave the same planner checks the result against the objective and
   may add up to 3 follow-up waves. The feed shows "replanning" and "replanned: <what changed>". If the plan no longer
   holds together, or a 4th follow-up is wanted, the plan stays held and you are asked ("needs you"). Turn it off
   with the "Replan between waves" box or `--replan off` (`jobs create`, `jobs plan`).
   **Review** (a planned Job, on by default, W7-E): every Task, from the planner, a replan or the coordinator, is
   checked by a fresh reviewer before it counts as done ("Awaiting review" on the board). A blocking finding goes
   back to the worker, up to 5 rounds, then the Task escalates. Turn it off with `--no-review` (`jobs create`,
   `jobs plan`), or for one Task with `tasks add --no-review`. A plan with no coordinator replans and gets its final
   check on the account its planner ran on.
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
   `--affected-paths '["src/a.ts"]'` names the files a Task changes, so it never runs beside another Task on the same
   files. A spec with quotes goes on stdin: `astera tasks add --job <job> --account <id> --spec - <<'EOF'` … `EOF`.

**Delivery** (per project; Jobs view → "When a plan is done", or `astera projects set --id <project> --delivery pr|push
[--delivery-branch <branch>]`; one plan can override it with `--delivery` on `jobs create` / `jobs plan`):
- `pr` (the default): one PR per plan, opened when the plan finishes, never merged automatically. A project with no
  remote gets no PR and no failure: the feed says "This project has no remote; the plan's work is on branch <name>".
- `push`: when the last Task passed review (and the final check is done), Astera merges the plan's worktrees into the
  project folder's delivery branch (the default branch unless set), runs the plan's validation checks once more on the
  merged tree, and pushes it, **with no review by a person**. The merge commits say `Fixes #n` for the issues the plan
  came from, so GitHub closes them. It stops and escalates (a sound and a notice) instead when the folder is on another
  branch or has uncommitted changes, when the branch cannot fast-forward to origin, on a conflict, when validation fails
  (its own merges are undone then), or when the push is rejected twice. It never stashes, resets your work or
  force-pushes. After a push the plan's worktrees are removed; after a stop they stay. `astera run-deliver
  --run <id> --force` tries a stopped push again.

## Starting from files, an audit, a problem list or GitHub issues (W6-A)

"+ New job" → **New plan from files, an audit or GitHub issues…** opens the New plan dialog. Pick the project and a
source, add **Extra instructions** if you like (they win over the source), set **Workers at once** (1–10, default 3,
or what the "+ New job" form had), pick the coordinator account, and press **Create and plan**: Astera makes one Job
and starts its planner.

**The plan's name** comes from its source: a problem list is named by its first problem, files by their names, an
audit "Audit <scope>", and issues by the first one and how many more ("#1 unique() is O(n²) +1"). The sidebar, tabs,
search, notices, the run's worktree branch and the PR all use it. Rename it any time; Astera never renames a plan
itself after that.

**Changing the worker count later**: the number in the Run window's header, or `astera jobs set --id <job>
--concurrency <n>`, until the plan finishes. A lower number only holds back new starts; running workers carry on.

- **Describe**: the objective. Tick "This is a list of problems" for one or more Tasks per problem.
- **Files**: drop PDFs or other files (at most 30 MB each). They are copied to `plans/<job>/inputs/` in the profile,
  and the planner reads them first (Claude reads PDFs itself, long ones in page ranges).
- **Audit**: a path or `all`. The planner audits it for bugs, security holes and missing tests, writes
  `inputs/audit.md`, then plans the fixes.
- **GitHub**: search the open issues ("Assigned to me" narrows to yours), tick several, and optionally "Assign me".
  One refused issue (closed, a pull request, or written by a non-member) refuses the whole plan.

From a shell: `astera jobs create --objective "…" [--mode plan|audit|fixlist] [--scope <path|all>]
[--instructions "…"] [--attach <file>]…`, `astera jobs-create-from-issue --project <id> --issue 12,14,19
[--assign-me]`, `astera github-issue-assign --project <id> --issue 12,14 --me`.

**Before planning, the planner checks what already exists**: the code, open and closed issues and PRs, and the
project's other Jobs. It writes `inputs/existing.md` (each item `missing`, `partial`, `broken` or `built`), plans only
what is missing or broken, and gives every Task a basis with evidence; approval is refused without one. If everything
is built, the Job ends as "nothing to do" (archived, the summary kept, a feed line and a notice) and no tab opens.
Every planner writes `existing.md` (an audit also `audit.md`) in the Job's `inputs/` folder, and no other file.
Writing them asks your permission once, as every planner edit does.

## Day to day (checked by W6-V and its re-run after Wave 7, 2026-10-18)

The loop that works today, from source to merged work:

1. **Open the project.** "+ New project" makes a folder, `git init`, a CLAUDE.md with GitHub rules and the first
   commit (it needs one open tab first, #104). The Jobs panel needs an open project: start a session in the repo once
   (or click a tab that lives there). A tab started with `astera sessions create` in an empty window is the window's session at once.
2. **Start the plan.** "+ New job" → **New plan from files, an audit or GitHub issues…**. Put one problem per line
   and tick "This is a list of problems" for a fixlist; add extra instructions; set "Workers at once" (up to 10);
   pick the coordinator account. `astera jobs set --id <job> --concurrency <n>` changes it later.
3. **Read the plan.** The planner's last message in its tab sums up the Tasks, waves and what you must decide. The
   Run window's board shows each Task's files and wave. Approve with **Run** (the app asks once).
   If approval says a Task "has no basis", tell the planner in its tab; it fixes the plan.
4. **Let it run.** Workers ask the coordinator, and you see "coordinator answered" in the feed and "N questions
   answered" on the card. You are called only for an owner decision, a give-up or a permission prompt: a desktop
   notice "Needs your decision" and a row in the needs-input list.
5. **Answer a decision.** Use the answer box on the Task's card (the needs-input row opens the plan), or
   `astera questions answer --id <id> --answer -`. See "Questions and escalations" below.
6. **Usage.** At `usagePauseAt` no new worker starts and the board says why. After raising it, or after the reset,
   held workers start on their own: the coordinator is told in its inbox, and plans the Host places get a pass at once.
7. **Done.** Between waves the board shows "Replanning wave N…"; after the last one the final check runs. With
   delivery `pr` the plan's PR opens (a project needs a GitHub remote); with `push` the work lands on the delivery
   branch, or Astera stops and tells you why (dirty folder, wrong branch, conflict) and touches nothing.
8. **Tidy up.** Ended tabs of a finished or archived plan close on their own (see "The workspace"). Archive a plan
   with `--kill-sessions` to end all its sessions at once.

Known gaps were issues #67–#84 (label `wave-6`), fixed by Wave 7's W7-C…W7-F. The re-run after Wave 7 found #92–#106
(W8-E, W8-F, W8-G; #106 in W9-F). Until they merge:
- **Same files.** A plan with a coordinator can run two Tasks on the same file at once (#92). Tell the planner
  "chain Tasks that share a file" in the extra instructions.
- **Talk to the planner from a shell** (`astera jobs feedback --job <job> --text -`): the app's box starts a fresh
  planner each time (#93). If Run says a Task "has no basis", tell the planner (#94).
- **A Gate from the coordinator** has no box on the card (#97): `astera questions list --status open`, then
  `astera questions answer --id <id> --answer "<option>"` (pass the option as an argument, not on stdin, #98).
- **After you answer**, the coordinator may wait up to 10 min to notice (#96): type "check your inbox" into its tab.
  A Gate asking you to `jobs-unhold` during "Replanning wave N…" is false (#95): answer "the replan ended, go on".
- **A plan with a failed Task** shows no end (#99): read its board, then archive it.
- **No remote + `pr`**: merge the plan's branch (`git merge <branch>` in the folder) before the next plan (#101).
- **`push` with a new bare origin**: set `--delivery-branch main` or run `git remote set-head origin -a` (#102).

## Projects (W7-B)

**New project.** "+ New project" asks for a name, a parent folder, an optional description and GitHub
private, public or none. It makes the folder, runs `git init`, commits and registers it. From a shell:
`astera projects create --name app --parent ~/code --github private`.

**Add an existing project.** `astera projects add --path <folder>`. The folder must be a git repository. With no
commit it is refused (409 needsInitialCommit); add `--initial-commit` to make the first one. The answer proposes
a test command, and the default branch is recorded.

**Settings.** Each project has a settings page; `astera projects set --id <projectId> …` does the same:
`--delivery pr|push`, `--delivery-branch`, `--auto-approve on|off`, `--test-command <cmd>` (saved as a run
configuration), `--test-config <id>`, `--concurrency 1-10`, `--review-rounds <n>`, `--replan waves|off`,
`--account <id>`. An empty value clears a setting to its default. Agent sessions and MCP cannot set these.

**Defaults.** Delivery pr, auto-approve off, concurrency 3, review rounds 5, replan waves. A new Task with no
`--validate` is validated with the project's test command. A new Job copies the project's concurrency, replan
and review rounds when it sets none.

## The workspace

The sidebar's **Workspaces** tree is Project → Plan → Planner / Coordinator / Workers. Clicking a session shows its
terminal. The header above it always says Project · Plan · Task · Model · Account · cwd · Branch · Status. Switching
sessions or plans never restarts a process or changes its cwd. Scrollback survives switching and a restart of the app.

- **Project workspaces** (W6-F): the switcher at the top of the sidebar lists each project with its number of
  running tabs, and a dot while one waits for you. Click a project, or press **Ctrl+Alt+1…9** for the first nine
  (rebind in Settings → Shortcuts). The grid then shows only that project's tabs: its plans' planner, coordinator and
  workers, plus every tab whose folder is in the project or in one of its worktrees. Tabs outside every project are
  under **Other**; **All tabs** shows everything. Clicking a plan narrows further, and clicking it again goes back to
  its project. Each workspace returns to the tab it had in focus when you left it, and a new tab opened in it starts
  in the project's folder. Tabs in other workspaces keep running, hidden.
- **Tabs.** An ended session's tab is struck through. When its plan is done or archived, every ended tab of the plan
  closes on its own, and a replan's planner tab closes once the plan has moved on, so replans leave no extra planner
  tabs. A closed worker opens its transcript from the plan's tree; every one stays in History. The ended tab of a plain session (not part of a plan) stays until
  you close it. Settings → General → "Close an ended plan's tabs on their own" turns this off.
- **Many tabs.** The chevron at the end of a pane's tab strip lists every tab of the workspace; click one to go there.
  **Ctrl+Shift+P** opens the quick switcher (rebind in Settings → Shortcuts): type to filter tabs by name, plan or
  Task, the same way search matches (`hw1` finds "Hold Worker 1"), then arrow keys and Enter.
- Each sidebar section (Workspaces, Activity, History) folds with its chevron, and stays folded across restarts.
- **Type into a worker**: click it in the tree and type. To send one line without switching, use the command bar:
  `send "run the tests" to Gameful Worker 2`.
- **Needs my input**: the number next to Workspaces counts sessions waiting for you (a permission prompt or a
  question). Click it for the list. The Host reads each session's hook events, so a wait that began while the app was
  closed is listed too, with what it waits on ("waits for your permission", "has a question for you").
- **Search**: the box under Workspaces matches sessions, plans and Tasks across projects, also by initials:
  `hw1` finds "Hold Worker 1". Each hit shows "project › plan · task".
- **Board**: the Run window's board shows every Task, and for each one that is not running, why ("waits for A",
  "App-wide limit full", "Its worker was stopped").
  The board opens first and groups the Tasks by wave ("Wave 1 · 3/4 done"), with the current wave highlighted and
  "Replanning wave 3…" on it while the planner adjusts the rest of the plan. Each card lists its files (three, then
  "+N more"), what its worker is doing now ("Editing src/x.ts · 0:12 ago", "Running npm test", "Waiting for your
  permission", "Asked the coordinator") and the questions the coordinator answered for it. Clicking a running card
  opens its tab. The **Files** tab lists every file of the plan with the Tasks that touch it; a file two Tasks share is
  highlighted, and clicking a file shows its folder in the explorer.

## Usage guards (W6-G)

- **Subagents per tab.** Every Claude tab Astera starts (workers, planners, coordinators and plain tabs) may run at most
  Settings → "Max subagents per tab" subagents at once (1–10, default 10). A tab that asks for one more gets "Astera: N
  subagents already running in this tab (limit N). Wait for one to finish." The count lives in
  `<profile>/hook-events/<session>.subagents` and goes back to 0 when the tab starts or resumes. A change of the setting
  reaches running tabs at their next subagent. A tab opened before this feature has none of these hooks until it is
  reopened.
- **Usage pause.** No new worker starts on an account whose latest statusLine reading is at Settings → "Pause new
  workers at usage (%)" (default 90) of its 5-hour or 7-day limit. If another account of the Task (its rolling order)
  is under the threshold, the worker starts there instead. Running workers are never stopped. With no reading yet,
  nothing is held. The pause ends on its own when a fresh reading is under the threshold or the window resets. A
  coordinator asking `worker-start` for a paused account is refused with the reason and, when there is one, the
  account to use instead. The board says "Paused: <account> at 93% of its 5-hour limit, resumes ~14:20". The feed and a
  desktop notice say when new workers pause and resume, without a sound: nothing is asked of you.
- **The usage strip** above the plan's board shows each account's 5-hour and 7-day share with its reset time, which
  accounts are paused, the threshold, and the live subagents per tab.

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
- **Questions and escalations (W6-B).** A worker asks its coordinator with `astera ask` (Claude workers start without
  Claude's own question tool), and the coordinator answers from the plan, the spec files and the repo. Each answer is a
  feed line, "coordinator answered", and never a notice. Only an owner decision is escalated: a product choice the
  plan leaves open, anything irreversible, data loss, security, money, or a question asked twice. An escalation, or a
  Gate opened because the attempts or review rounds ran out, is a desktop notice ("Needs your decision") and a row in
  the needs-input list until you answer it, or its Task or plan ends.
- **How you answer (W7-C).** Each open escalation and each open `astera ask` question gets an answer box on its Task's
  card in the plan's board: the question, its options as buttons, a text box and **Send answer**. Clicking the
  "Needs your decision" row in the needs-input list opens that plan's board. From a shell: `astera questions list
  --status open` lists Gates, asks (`source: ask`) and escalations (`source: escalation`) in one list; `astera questions
  get --id <id>` shows one; `astera questions answer --id <id> --answer -` answers it. Your answer goes to the worker's
  open question as the coordinator's would (its `ask` returns it within seconds), and the coordinator gets a copy in
  its inbox ("the owner answered"). If the worker no longer waits, the coordinator passes it on. The feed shows "answered
  by you", never a notice. Only you answer an escalation: an agent session that tries is refused.
- **Chime.** Settings → Notifications → "Chime when something needs you" (on by default): a short two-note chime with
  the notice for a permission prompt, a question, an escalation or a Gate, at most one every 5 s. The OS notice is then
  silent, so you hear one sound.
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
| act | plan X, send text to a session, change the plan / tell the planner (W7-A), resume, pause / stop launching (a hold: nothing closes) | after you press **Run** (or Enter on an empty line); pausing one worker also asks in the app's dialog |
| confirm | approve and start, reject the plan, stop, archive, delete, merge | only after a click in the app's confirmation dialog |

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
