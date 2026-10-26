# Concepts

Every Astera term in one place: what it is, where you see it in the app, and the page with the depth.

## The picture

You give a **project** a goal. A **planner** cuts it into a **plan** of **Tasks**, you approve it, and a **coordinator**
starts a **worker** for each Task in its own **worktree**, wave by wave. A **reviewer** checks every Task, a final check
compares the result with the goal, and the plan is **delivered** as a pull request or a push. The **Host** runs all of
this in the background, so closing the window stops nothing.

<img src="../assets/docs/diagrams/plan-lifecycle.svg" width="760" alt="A goal goes to the planner, you approve, the coordinator starts workers in waves, a reviewer checks each Task, then a final check and delivery" />

## Work

### Project
A git folder Astera works in. Pick or add one in the title bar's project switcher; every view shows that project's
plans, consoles and worktrees. A plain folder that is not a git repository is not a project.
Depth: [guide, Projects and windows](guide.md#projects-and-windows).

<img src="../assets/docs/project-switcher.png" width="760" alt="The title bar project switcher open with several projects" />

### Main plan
The page that gathers a project's plans (its sub-plans) and their open Tasks in one place. Open it from the top of the
Plans view ("Open main plan"). Depth: [guide, Plans](guide.md#plans).

<img src="../assets/docs/main-plan.png" width="760" alt="The Main plan page with several sub-plans and their open Tasks" />

### Plan (Job)
One goal cut into Tasks. The app calls it a plan, the CLI calls it a Job (`astera jobs …`). It has a state, a
delivery mode and optional **areas** (1–3 short words that mark what it touches). The Plans view lists every plan as a
tree (plan › step › Task); click one to open its tab.
Depth: [guide, Plans](guide.md#plans), [Jobs](jobs.md).

<img src="../assets/docs/plans-tree.png" width="760" alt="The Plans side bar tree with plans in mixed states next to an open plan tab" />

### Step and wave
A Task's **wave** is its dependency depth; the plan tab draws a wave as a **Step**. A wave starts only when every earlier
one has completed. At each boundary a fresh planner may adjust the Tasks that have not started (replanning), and after
the last wave it checks the result against the goal (the **final check**) and may add up to 3 follow-up waves.
Depth: [guide, While it runs](guide.md#while-it-runs).

### Task
One work item: a title, a spec, affected paths, "Done when" criteria and dependencies. Each attempt at a Task is one
console. A Task row shows a state icon and a **live line** ("Running npm test", "waits for A"). Click it to open its
console, or its place in the plan. Depth: [guide, Tasks](guide.md#tasks).

<img src="../assets/docs/task-detail.png" width="760" alt="One Task's detail with attempts, review and files" />

### Task states

| State | Meaning |
|---|---|
| `pending` | Waits for its dependencies |
| `ready` | Dependencies done; waits for a worker |
| `dispatched` | A worker is on it |
| `validating` | Its run-configuration checks are running |
| `reviewing` | Another agent, on a different provider, is judging it |
| `blocked` | A Gate (an open question) waits for a decision |
| `completed` | Reported, checked and reviewed |
| `failed` | Out of tries; after 3 failures in a row there are no more retries |

Depth: `astera help 2`, [Jobs, How Tasks run](jobs.md#3-how-tasks-run).

### Gate (a question for you)
A decision block. Attempts or review rounds that ran out, a review no code change can fix, or a worker that asks
something only the owner can decide, become a **Needs you** row you answer with a button or text and **Send answer**.
Hands-off plans decide for themselves. Depth: [guide, Needs you](guide.md#needs-you).

<img src="../assets/docs/needs-you.png" width="760" alt="A plan with an open question and its answer buttons, and the bottom panel's Needs you tab listing four open items" />

### Delivery: `pr` or `push`
What happens when a plan finishes. `pr` (the default) opens one pull request and never merges it. `push` merges the
plan's worktrees into the delivery branch, re-runs the checks and pushes, with no person reviewing. Set it in
Settings → Projects → "When a plan is done", or per plan with `--delivery`.
Depth: [guide, Delivery](guide.md#delivery), [Jobs, delivery](jobs.md#4-when-it-is-done-delivery-or-a-merge-you-press).

## Agents

### Console
The real `claude` or `codex` terminal of one session, shown as a tab, never a copy. The **Agents** view lists the
project's consoles in **Needs you**, **Working**, **Idle** and **Finished**. You type into the CLI itself; there is no
Astera input box. Depth: [guide, Agents](guide.md#agents).

### Planner
Writes the plan: Tasks, dependencies, affected paths, criteria and difficulty. You approve it, or **Talk to planner**
first. Depth: [guide, Approve it, or talk to the planner](guide.md#approve-it-or-talk-to-the-planner).

<img src="../assets/docs/start.png" width="760" alt="The Start tab with the New plan composer" />

### Coordinator
Places one worker per ready Task, answers workers' questions from the plan and the repo, and escalates only owner
decisions. It plans and places; it does not edit files. Depth: `astera help 1`, [guide, Needs you](guide.md#needs-you).

### Worker
The agent that does one Task in its own worktree and ends with an explicit report. A retried Task starts a fresh worker.
Depth: [guide, While it runs](guide.md#while-it-runs).

### Reviewer
A fresh agent, on a provider other than the worker's, that checks each Task before it counts as done. A blocking finding
goes back to the worker, up to 5 rounds, then the Task escalates. Turn it off with `--no-review`.
Depth: [Jobs, When something fails](jobs.md#6-when-something-fails).

### Difficulty, model and effort
Each Task has a **difficulty** (light, standard, hard) that picks the model (haiku, sonnet, opus) and an **effort**.
Every failure raises the next attempt one rung: effort first, then model. Set the role models in Settings → Agents →
Orchestration models. Depth: [guide, Before the first plan](guide.md#before-the-first-plan).

<img src="../assets/docs/settings-agents.png" width="760" alt="Settings, Agents: the orchestration model for each role" />

## Machinery

### Host
The background process that owns every console and drives every plan, so workers, rolling and schedules go on with the
window closed. The status bar shows its state. `astera host status|start|stop` controls it.
Depth: [CLI, The Host](cli.md#the-host), [Linux notes](dev/LINUX.md).

### Worktree
Each worker gets its own git worktree under `~/astera-worktrees/<repo>/<name>` on a branch `<git user>/<name>`. The
**Worktrees** pane of Source Control lists them (**Ready to clean up**, **Yours**) and removes finished ones.
Depth: [guide, Worktrees](guide.md#worktrees), [Jobs, where worktrees go](jobs.md#appendix-where-worktrees-go).

<img src="../assets/docs/source-control.png" width="760" alt="Source Control with worktrees and changes" />

### Account and account rolling
An account is one signed-in Claude or Codex login. When a session reaches its usage limit, **rolling** resumes it on the
next account for the same service. Each account keeps its own limits.
Depth: [Usage guide, Use multiple accounts](usage-guide.md#use-multiple-accounts).

<img src="../assets/docs/accounts.png" width="760" alt="Accounts and usage with several accounts and usage bars" />

### Usage guards
No new worker starts on an account at or over "Pause new workers at usage (%)" (default 90) of its 5-hour or 7-day
limit; running workers are never stopped. The Task's live line says "Paused: …". Depth: [guide, While it runs](guide.md#while-it-runs).

### Run configuration
A saved command (build, test, dev server) in the **Run** view. Attached to a Task with `--validate`, it becomes the
check that moves the Task through `validating`. Depth: [CLI](cli.md); `astera run-configs list --job <job>` lists a plan's.

### Remote runtime
Another machine running Astera's Host that this app pairs with and drives. Depth: [Remote Runtime](remote-runtime.md).

### How It Works records
An experimental plain-language record of what finished work changed and why. A finished Run is recorded; a session only after you enable tracking. Depth: [How It Works](how-it-works.md).
