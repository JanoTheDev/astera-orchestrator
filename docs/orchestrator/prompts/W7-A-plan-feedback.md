You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md (especially "Wave 6 — Autopilot", its contracts, and "Wave 7"), docs/orchestrator/USAGE.md
and the SPEC.md sections named below. Inspect the existing code named here before writing anything. Extend
existing code; do not build parallel systems. Wave 6 is merged; build on it. Use the Wave 6 and 7 contract names exactly as PLAN.md spells them.

Worktree + branch (rule 1 in CONTEXT.md): slug `w7-plan-talk`, branch `feat/orch-plan-feedback`.

SPEC sections: §2, §3.

# W7-A — Talk to the planner: request changes, reject, or let it run without asking

At the approval step the owner wants to say what is wrong ("T3 is too big, split it", "don't touch the auth
service", "you missed the mobile view") and get a revised plan, not just Approve. The same box must work while the
plan runs. The goal is maximum automation, so a project can also skip approval entirely.

Read first:
- `lib/jobActions.ts` (`approvePlan`), the plan card and the plan view (`components/plan/*`, `JobsView.tsx`)
- `exec/plannerStart.ts`, and how #47 ends the planner session
- W6-D's `exec/replanStart.ts` and `replan.ts`
- the command bar intents (`core/intents/*`)
- `lifecycle.ts` (`archiveJob`)

1. **Request changes** (plan not yet approved):
   - A "Talk to the planner" box under the plan, with a send button and the history of what was said.
   - Sending **resumes the same planner Claude session** (`resumeSessionId`), so it keeps everything it already
     read. That is cheaper than a fresh planner. Your text is the prompt, under "Owner feedback on the plan".
   - The planner revises Tasks with `task-update` / `task-create` / cancel, writes one short line per change
     ("Split T3 into T3a/T3b"), and ends.
   - The plan becomes ready again: chime plus notice, with a changes list on the plan view.
   - Loop as many rounds as the owner wants.
   - If the old session cannot be resumed, fall back to a fresh planner given `plan.md`, `existing.md` and the
     whole feedback history.
2. **Reject:**
   - A "Reject" button asks for an optional reason, archives the Job (`archiveJob`) and records the reason on it.
   - No tabs open. Undo is the existing unarchive.
3. **Feedback during a run:**
   - The same box stays on a running plan.
   - A message there is passed to W6-D's replan as "Owner feedback". W6-D's rules for what a replan may change
     stay as they are: it changes only Tasks that have not started.
   - The replan starts at once rather than waiting for the wave boundary. Hold dispatch while it runs.
   - Running Tasks are not touched. If the feedback concerns one of them, the planner says so and the owner can
     stop that Task from its card.
4. **Command bar:** "change the plan: …" / "reject the plan" for the selected plan go to the same commands.
5. **Auto-approve:**
   - `Project.autoApprove?: boolean`, default false, with a Job override.
   - When true, a plan that passes `validatePlan` starts at once. A notice "Plan started: 7 tasks" with a
     **Stop** action and the feedback box replace the approval step.
   - Setting UI: the project settings page (W7-B mounts it; this tab provides the toggle component).
6. New commands, each in `cliUsage.ts`:
   - `jobs-feedback --job <id> --text <t>`
   - `jobs-reject --job <id> [--reason <t>]`
   The planner may not call either one (`PLANNER_COMMANDS` stays an allowlist).

Ownership: see the W7-A row of PLAN.md.
