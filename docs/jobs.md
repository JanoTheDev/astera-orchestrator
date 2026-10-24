# Jobs: from creation to delivery

What happens to one Job between the moment it is made and the moment it is delivered or deleted. A **plan** is a Job;
the [guide](guide.md) covers the day-to-day side (the Start page, approving a plan, waves, review, the Inbox). This page
is the mechanics underneath: worktrees, how Tasks share them, merging, deleting, failures and scheduled Jobs. Sections
1 to 6 are plain Jobs; section 7 is scheduled Jobs. The commands are in the [CLI reference](cli.md).

## First: the project must be a git repository

**Before a Job can run, its project folder must be a git repository with at least one commit.**

A Job's workers always work in git worktrees. Without a repository there is no worktree, so the Job does not start
and a Gate says why. The "Create a job" dialog says so up front ("Runs only in a folder that is a git repository"); it
does not stop you making the Job, but the Job will not run.

If the folder is not a repository yet, either add it as a project (`astera projects add --path <folder>
--initial-commit` makes the first commit), or run in the folder:

```
git init
git add -A
git commit -m "first commit"
```

**HEAD must also point at a branch.** In the middle of a bisect or a rebase, or with a commit checked out directly
(detached HEAD), there is no branch to fork from, and the Job stops for the same reason.

## 1. Create

Making a Job starts nothing, and neither does adding Tasks to it. The Job is marked `pendingStart` and has no run yet.
It starts when you press **Run** on its plan page (`astera jobs run --id <job>`), or, for a planned Job, when you
approve its plan (**Approve & execute**, or automatically with auto-approve). Plans made on the Start page go through
the planner first; see [Start: make a plan](guide.md#start-make-a-plan).

Where a Job comes from:

- **Start page** (New → Plan it for me / Run as written): a planned Job. The planner writes the Tasks.
- **Plans page → + New job** ("Create a job"): an objective, a coordinator account, **Run at once**, and optionally
  **Scheduled run** (section 7). With "Plan with planner first" ticked, the planner writes the Tasks; otherwise you
  add them yourself.
- **CLI / MCP**: `astera jobs create` or MCP `create_job`. `jobs create` makes the Job and runs nothing.

A Job with a coordinator account may run with no Tasks at all, as a Job from `jobs create` or `create_job` often does.
Its coordinator then plans first: it breaks the objective into a few Tasks (with dependencies, an account, and the
project's run configurations as checks) and runs them. A Job that has Tasks is run as it stands; the coordinator
creates no Tasks of its own.

**The coordinator plans and places; it never edits files.** Its session runs in the project folder itself, not in a
worktree, so all editing, building and committing is done by the workers that take the Tasks.

Nothing is written to disk at this point. A Job that never runs leaves no empty folder behind.

### Stopping and resuming a run

`astera runs stop` (MCP `stop_run`) closes the run's open workers, stops its coordinator and pauses the run. It is
reversible. A run that has already finished (every Task completed, or failed with no retries left) is refused with
`CONFLICT` and left as it is: there is nothing to stop. Its coordinator and idle workers end on their own, 10 minutes
after the later of the run finishing and the last time a person typed into that session. In between you can read the
coordinator's closing summary in its console or ask it a follow-up; each input starts the 10 minutes again. Only typing
in an Astera console counts, and a Slack reply while the Host drives; `sessions send` does not, because agents use it
too. A session that is busy in a turn is not cut off mid-turn for up to an hour: it is ended once it is idle again, or
an hour after the 10 minutes ran out if it still shows busy then (read as hung). A run of a scheduled Job has nobody
watching, so it is cleaned up at once. A worker held with `worker-retain` is never ended. To end a coordinator now:
`astera run-coordinator-stop --run <runId>`.

`astera runs resume` (MCP `resume_run`) clears the pause and, for a Job with a coordinator account, starts a new
coordinator, which looks at what is already done and carries on. If the old coordinator is still shutting down, the
resume waits up to 10 seconds; if it is still there, the resume is refused and changes nothing. Try again a moment
later. Both commands refuse while a worker is held with `worker-retain`.

The plan page's **Pause** is different: it is a **hold**. No new worker starts, running workers carry on and nothing is
closed. See [While it runs](guide.md#while-it-runs).

## 2. Run

**The run gets its own working folder, a git worktree.** It is made when the first worker is placed or the coordinator
starts, not when the Job is created.

The worktree forks from **the branch checked out in the project folder**. If you are working on `develop`, the worktree
starts from `develop`, not from the project's default branch; forking from the default branch would drag unrelated
ancestry into the merge later.

From then on **agents do not touch the project folder.** You can keep editing files there; nobody steps on anybody.

## 3. How Tasks run

The Job's concurrency decides it: **Run at once** in "Create a job", **Consoles at once** on Start,
`--concurrency` on the CLI. **The default is 3.** It can be changed later with `astera jobs set --id <job>
--concurrency <n>`.

**Change a running plan.** `astera jobs set --id <job>` also takes `--priority`, `--review-rounds`, `--replan waves|off`,
`--auto-approve on|off`, `--hands-off on|off` and `--delivery pr|push`, in any mix, on a running or queued plan. They
are checked together and written once; one bad value changes nothing. A change applies to work that has not started
yet (running workers and reviews carry on). `--delivery` is refused once delivery has started, every flag is refused
once the plan has finished, and `--hands-off` is refused from an agent session.

**Concurrency 2 or more (default 3).** Each Task gets its own worktree. Before a Task that depends on earlier Tasks
starts, their results are merged into the run's worktree, and the dependent Task forks from there.

- Astera merges them itself.
- On a conflict it creates an integration Task and hands the merge to an agent. A person is called only as a last
  resort (a Gate), for example when the integration Task finished and the worktrees still do not merge.
- A Task worktree that has been merged is removed right away, unless something is still using it, so folders do not
  pile up.

**Concurrency 1.** Tasks take turns in one worktree. When Task 1 finishes, Task 2 works in the same folder on top of
its result. Nothing needs merging.

The **Start** button on a Task node in the plan's dependency graph launches that one Task by hand (to retry one held
at a Gate). **It exists only on a Job with concurrency 1, after Run was pressed, and not on a schedule template.** With
2 or more, every worker runs in its own worktree, and a worker started by hand would go to the run's worktree, the
folder the integration Task merges into. So the button is not there and the scheduler does that work instead. Since
the default is 3, **a Job made with the defaults never shows this button.** A schedule template never runs its own
Tasks (section 7); its runs show the button as usual.

Two Tasks that edit the same files run side by side, each in its own worktree, in one plan or across plans of the
project; the merge worker settles a conflict when their branches meet. A project with serial files on runs them one at
a time; see [While it runs](guide.md#while-it-runs).

## 4. When it is done: delivery, or a merge you press

When a run completes (and, for a planned Job, its final check is done), Astera **delivers** it by the project's
delivery mode. The full rules are in [Delivery](guide.md#delivery):

- **`pr`** (the default): one pull request per plan. **Astera never merges it.** With no remote, the work stays on the
  plan's branch and the feed tells you the `git merge` to run.
- **`push`**: Astera merges the plan's worktrees into the project folder's delivery branch, runs the checks once more,
  and pushes, with no review by a person. It stops and asks you instead of touching a dirty folder, the wrong branch
  or a conflict.

A scheduled Job's runs are never delivered (section 7).

**The local Merge.** The plan page's **Merge** button (`astera run-merge`) folds what the workers committed into the
**current branch of the project folder**, at a moment you choose. It changes the working tree you have checked out, and
you may be working in it, so Astera never does this on its own.

| Situation | Result |
|---|---|
| The project branch has not moved | Fast-forward: no new commit, the worktree's commits become the branch's history |
| The project branch moved in the meantime | One merge commit |
| Tracked files in the project folder have uncommitted changes | Nothing is merged; you are told why. Nothing is lost |
| The project folder is not on a branch, or is mid-rebase, bisect, cherry-pick or merge | Nothing is merged; you are told why |
| Conflict | The merge is aborted back to where it was, and you are told why |
| A worktree has uncommitted changes | That worktree is not merged; its changes stay in the folder |
| The worktree folders are already gone | "Nothing left to merge" |

The local Merge does not push and does not switch branches. The worktree folders stay after it, so you can look at the
result and merge again; removing folders is a choice you make when deleting (section 5) or on the
[Worktrees](guide.md#worktrees) page, which also removes a plan's ready worktrees by itself once the plan is delivered.

### How It Works records

With How It Works tracking on, each finished run becomes one record. The Astera Host writes it, so a run that finishes
while the window is closed is recorded too, and shows up in How It Works (More ▾) when you open the app again. Whether a
person's own sessions are recorded is still up to the tracking setting. See [How It Works](how-it-works.md).

## 5. Delete

Deleting a Job (**Delete job** on the Plans page, or `astera run-delete`) that used worktrees offers three choices,
all off by default:

- **Merge into the project folder**
- **Hide from the history list**: it leaves the list, the record is kept
- **Delete the worktree folders**

**The merge comes first, and if it fails nothing is deleted.** Deleting after a failed merge would throw away the
workers' commits with their branch.

A plain Job with workers still open is refused ("stop them first"); stop the run, then delete.

### Deleting without merging does not throw the work away

A folder that holds **uncommitted** changes is never removed, with or without the merge; it is kept and listed, and you
can look at it and delete it from the Worktrees page. When a folder is removed, its branch is deleted only if it is
already merged: git refuses to delete a branch with unmerged commits, so that work survives under its branch name.

## 6. When something fails

Failure is never silent. It shows as a Gate with a reason a person can read, and lands in the [Inbox](guide.md#inbox).

| Situation | Result |
|---|---|
| The project is not a git repository | The Job does not run. See "First" above |
| HEAD is not on a branch | The same. Check out a branch, then answer the Gate |
| No account the Task can use | Gate |
| Merge conflict | An integration Task, or a Gate when there is nothing left to hand it to |
| Attempts or review rounds ran out | Gate ("Needs your decision" in the Inbox) |

**Each failure makes the next attempt stronger.** A failed review, failed checks or a failed worker report raise the
Task one rung above what the failed attempt ran on: the effort first, then the model (haiku, sonnet, opus), up to opus
at max effort. Example: sonnet/medium, sonnet/high, opus/high, opus/xhigh, opus/max. A model with no tier (a codex or
vendor id) only climbs the effort. The Task's model, effort and the reason for the step are saved on the Task. A raise
starts a fresh worker in the same worktree, since a running session keeps the model and effort it started on. A session
that was lost or killed is not a step.

## 7. Scheduled Jobs

With a schedule on, **the Job itself never runs.** It becomes a template that holds the definition. At each fire time
it makes one run of the Job and runs that. The runs are the record.

```
"Daily 09:00 report"   <- the template. Never runs. Holds only the Task definitions
   ├── run #3
   ├── run #2
   └── run #1
```

Running one Job over and over would mean wiping the last run's Task states and events every time, and then you could
not see what failed yesterday. Separate runs keep the record.

### Making one, and when it fires

Plans page → **+ New job** → tick **Scheduled run** and pick a rule: every N minutes, daily, weekly or monthly at a
time. A coordinator account is required. A schedule has no planner option: its Tasks are copied into every run, so you
lay them out by hand. The Start page and `astera jobs create` have no schedule option.

**The schedule starts when you lay out the Tasks and press Run**, as with any Job. Except that pressing it does not run
anything right then; it makes the schedule live. Pressed at 08:59 with a rule of daily 09:00, the first run starts a
minute later; pressed at 09:01, the next day at 09:00. Until then the row says "Press Run to start the schedule".

Before Run is pressed the schedule neither fires nor even sets its next time. If it did, a time that passed while you
were laying out the Tasks would become the first fire, and pressing the button would start an overdue run at once.

After that, the process that drives (the Host, or the app when no Host drives) checks every 15 seconds, and when a time
has passed it makes a run and starts it. The Host fires whether or not the window is open.

**Nothing fires right after a start.** A template seen for the first time only sets its next time. Otherwise every
launch would fire a run.

**Missed fires are dropped.** Times that passed while nothing was driving are not caught up; counting starts again from
the next time.

**A fire is skipped while the Job's latest run is still running**, the same rule that makes `jobs run` refuse a Job
that is already going. The skip is logged once and that fire is not retried; the next one is the next scheduled time.
So two runs of one schedule do not overlap. (A finished run whose coordinator is still open, or a run with nothing
left but an idle coordinator, is replaced: that coordinator is stopped and the new run starts.)

Each fire of a Job with a coordinator account starts a fresh coordinator, at the cost of one coordinator's usage per
fire. A run that finishes has its coordinator stopped at once.

### Pausing and resuming

The template's row on the Plans page has a **Pause** / **Resume** toggle (⏸ / ▶). It is separate from the **Run** button
on the plan page, which is the button that **starts** a schedule for the first time; stopping and starting again is a
different act.

**Pausing stops the workers that are running now.** Every run of that schedule is stopped with it, and you are asked
first. If a session is held with `worker-retain`, the pause is refused; release it first.

**A paused run does not continue.** Resuming runs **a new run at the next scheduled time**. The stopped run's Tasks stay
stopped, and resuming the schedule does not bring them back.

While paused, the row shows "Paused" instead of "next …".

### How a run runs

A run gets a copy of the template's Tasks, dependencies included (a template with no Task definitions, whose
coordinator made the Tasks inside a run, copies the last run's Tasks). After that it runs like any Job: its own
worktree, Tasks in turn or side by side by the concurrency.

Gate answers, Task retries and stopping a worker all work in a run. Tasks added to the template go into every later
run; a Task added to one run (`tasks add --run`) belongs to that run only.

### When a run ends

**A completed run's worktree folders are removed automatically**, so a folder does not pile up per fire.

The folders go, but **what the run did stays.** A branch with unmerged commits is not deleted (git refuses), so it
survives, and its name is logged.

**A failed run keeps its folders.** A failure is a reason to open them.

**A run's work is never brought into the project for you**: no PR, no push, no merge. The folders are gone, so the
**Merge** button has nothing to reach ("Nothing left to merge"). To take a run's work, merge its branch yourself.

So a schedule fits work where **running it is the point**: running the tests every day to see the result, or writing a
report. "Fix things every day and land them in the project" is not what this feature does yet.

### The list

A template is one row on the Plans page, marked "Scheduled", however many runs pile up. The row shows the rule, the
next fire time and how many runs so far ("Waiting" if it has never fired). The runs fold under the template, newest
first.

**Run numbers never go back.** If you have reached run #5 and delete the first two, the next is still run #6: the number
is stamped when the run fires.

### Deleting

Deleting one run removes only that record, with the same three choices as any Job.

**Deleting the template deletes all its runs.** Running workers are stopped first. If a session is held with
`worker-retain`, nothing is deleted; release it first. Note that the workers are closed and a chosen merge is made
before a folder removal can be refused, so after such a refusal the Job and its runs are kept but the workers are
already closed.

Finished runs are cleaned up automatically 30 days after they finish.

### Plain Job and scheduled Job compared

| | Plain Job | Scheduled Job |
|---|---|---|
| Starts | You press Run, or approve the plan | At the scheduled time |
| Jobs | One | 1 template + N runs |
| Worktree | One per run | One per run |
| Folders after it ends | Kept until delivery cleans up, or you delete them | Removed automatically (a failed run keeps them) |
| Into the project | Delivery (`pr` or `push`), or the Merge button | Never automatic; merge the branch yourself |
| Editing Tasks | Yes | On the template, for every later run |
| Overlapping runs | `jobs run` refuses while one runs | A fire is skipped while one runs |

## Appendix: where worktrees go

| | |
|---|---|
| Folder | `~/astera-worktrees/<repository name>/<name>` |
| Branch | `<git user name>/<name>` |
| Forks from | The branch checked out in the project folder (a dependent Task: the run's worktree) |

The name comes from the Job's objective (for a Task, its title) and is cut at 40 characters, at the `-` before the cut
when there is one in the second half rather than mid-word, so even a paragraph-long objective does not make the folder
and branch names too long. A name ending in `.lock`, which git refuses, becomes `-lock`. If the name is taken, a number
is appended. Every worktree is listed on the [Worktrees](guide.md#worktrees) page.

See also: the [guide](guide.md), the [CLI reference](cli.md), [How It Works](how-it-works.md) and the
[main README](../README.md).
