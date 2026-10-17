# Orchestrator spec (owner's requirements, condensed — every requirement kept)

## 1. Core
- Natural-language instructions manage coding work across many projects and plans.
- Example: "Work on the trading refactor in Gameful. Have Opus analyze, plan, split into independent tasks, and
  execute them in parallel batches."
- No manually creating sessions or copying prompts between terminals.

## 2. Planning vs execution (kept logically separate)

**Planning**
- A dedicated Claude Code session runs on the configured *premium planning model*.
- It gets the task, the repo context, and the project instructions (CLAUDE.md etc.).
- It must output: the plan, explicit worker prompts, task dependencies, affected files or modules, and
  acceptance criteria.
- The planner must **not** implement anything.
- The plan and tasks are persisted in a structured format.

**Execution**
- Parse the plan into tasks and work out which are safe to run in parallel.
- Launch workers through the existing session system, each with its prompt and the correct repo/worktree.
- Track each worker's state and output.
- Launch dependents automatically when their dependencies are satisfied.

## 3. Dependency-aware batching
- Any number of tasks. The concurrency limit is configurable. Nothing is hardcoded (no fixed batch sizes or
  task counts).
- Scheduling uses an explicit dependency graph, not numbered batches.
- Before launching a task, verify its deps are complete and its environment is ready.
- "Done" is never "the terminal went quiet". Use real session or process status, explicit completion
  signals, exit codes, and validation.
- Handle failure, retry, blocked, cancelled, and manual approval states without launching dependents by
  accident.

## 4. Models and cost
- Separate model configuration for each role:
  - a lightweight conversational coordinator
  - a premium planner
  - workers
  - optional reviewers/verifiers
- The coordinator handles status questions, voice transcripts, and scheduling without calling the premium
  model.
- Concurrency and model-selection policies are configurable.
- Reuse the existing account management and usage tracking. Never assume quotas combine, or that automatic
  account switching is allowed under every provider's terms.

## 5. Projects and plans
- Project → Plan → Tasks → CLI sessions.
- Many repos, and many independent plans per repo. Example: Gameful has Trading, Redis perf, and GitHub
  integration.
- Each plan has its own:
  - status
  - task graph
  - queue
  - sessions
  - progress summary
- Plans run at the same time without mixing prompts, branches, statuses, or sessions.

## 6. Interactive terminals
- Every planner and worker is a genuine interactive CLI session, built on the existing terminal system.
- What the owner can do:
  - see live output
  - scroll back
  - type directly
  - send extra instructions to one worker
  - pause, resume, cancel, or restart
  - switch between sessions without losing state or scrollback
- What each session shows: project, plan, task, model/account, cwd, branch, status.
- Orchestrator instructions must reach the correct session.
- No second terminal or session system.

## 7. GitHub
- Inspect the existing GitHub integration first.
- The owner's CLAUDE.md workflows already create Issues and add them to GitHub Projects. **Preserve that.**
- Link each task to its issue, branch, commits, and PR.
- Show status in the UI.
- Never create duplicate issues.
- Respect repo-specific instructions.
- GitHub stays the source of truth for shared tracking. No competing tracker.

## 8. Voice / natural language
- Voice is an integration layer, not a UI replacement.
- Example commands:
  - "Plan the next Gameful refactor"
  - "Start executing the approved plan"
  - "Show progress on Redis"
  - "What are workers waiting for?"
  - "Pause worker three"
  - "Send this to the API worker"
  - "Summarize the last 15 min"
  - "Stop launching new tasks for this plan"
- Workspace commands:
  - "Switch to Gameful Trading"
  - "Show the Value List terminals"
  - "Pause the Console plan"
  - "Summarize active Trading workers"
  - "Start the next eligible Value List tasks"
  - "Show every session needing my input"
- Reuse existing voice if there is any (there is effectively none). Otherwise define a clean speech and
  push-to-talk interface.
- Voice is **never** authorization for destructive operations.
- Ambiguous commands → ask which workspace or session is meant. Never guess.

## 9. Progress and notifications
- A unified activity feed across projects and plans.
- Live task and session status.
- Completion and failure notifications.
- Periodic summaries at configurable intervals, with event-based updates. No flooding.
- Blocked or waiting tasks, each with a reason.
- Which model or account did each task.
- Clear distinction between completed, failed, cancelled, and awaiting review.

## 10. Implementation rules
- Inspect the architecture first. Make the smallest necessary changes and follow the conventions.
- No rewrites.
- Persist orchestrator state. Recover after restart **without duplicate workers**.
- Tests for:
  - dependency scheduling
  - concurrency limits
  - failures
  - cancellation
  - persistence
  - session routing
- Run the existing suite. Never claim untested work is done.
- Explain limitations and propose the smallest extension.

## 11. First milestone
1. Create and persist a plan.
2. A separate premium planning session.
3. Its output becomes structured tasks with deps.
4. The tasks appear in the existing UI.
5. Eligible tasks launch as real interactive sessions.
6. The next eligible tasks are scheduled automatically.
7. Every session can be inspected and typed into.

## 12. Workspaces (additional)

**Sidebar**
- Expandable Project → Plan tree.
- Each plan owns a Planner session and Worker sessions, plus tasks, activity, and GitHub links.
- Clicking a plan opens its workspace:
  - session list
  - main interactive terminal
  - task/dependency board
  - overview and progress
  - recent activity
  - related issues, branches, and PRs
- Search sessions across all projects without losing their project/plan context.

**Switching plans must never:**
- close or restart a process
- lose scrollback
- change the cwd
- route input to the wrong plan
- mix queues

Sessions keep running in the background.

**Scheduling across plans**
- Each plan has its own queue.
- A **global** maximum concurrency applies, and capacity is shared across plans by configurable priority.
- Pausing one plan never pauses other plans.

**Lifecycle**
- Plans can be created, renamed, archived, paused, resumed, and switched.
- Archiving does not kill sessions unless the owner explicitly asks.
- A restart restores metadata, task states, session links, and terminals without duplicates.
