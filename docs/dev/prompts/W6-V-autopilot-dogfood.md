Run in ONE Claude tab after Waves 6 and 7 are merged. Run alone: nothing else on the laptop (CONTEXT rule 7).

You are in /home/jonx/Desktop/Astera (my private fork, repo JanoTheDev/astera-orchestrator). Read
docs/dev/CONTEXT.md, PLAN.md ("Wave 6 — Autopilot"), LINUX.md and USAGE.md first.

# W6-V — Dogfood the autopilot end to end

Use a throwaway git repo (`/tmp/astera-dogfood`, a small TypeScript project with a test script) as the Project.

1. In the running app, start a plan with the "New plan" dialog:
   - Fixlist mode, 6 small problems, 2 of which touch the same file.
   - One extra instruction.
   - Worker concurrency 10.
2. Watch, and record in a log:
   - The planner makes waves and fills `affectedPaths`.
   - The two same-file tasks never run at once; their "waiting for … same files" reason shows.
   - A worker question is answered by the coordinator, and the answer appears on the task card.
   - Force one escalation: a problem that needs an owner decision. The chime plays once and a desktop notice shows.
   - The replan banner appears between waves, and the final check runs.
   - The plan view shows each tab's "now" line, and project switching shows only this project's tabs.
   - In one worker tab, ask for 12 parallel subagents: the 11th and 12th are refused with Astera's message. Set
     `usagePauseAt` below the account's current 5-hour percentage: no new worker starts, the reason shows, and it
     resumes when you raise it again.
3. Start a plan for something the dogfood repo already has. Check that `existing.md` marks it, that no build Task
   is made, and that it ends either as "nothing to do" or with fix Tasks only.
4. Repeat the start with:
   - a 3-page PDF (`--attach`)
   - `--mode audit --scope src`
   - two GitHub issues on a scratch repo with `--assign-me`. Ask me before creating issues anywhere: that is
     outward-facing.
5. Make the dogfood repo with W7-B's "New project" (no `--github`). At approval, send two rounds of feedback
   through the planner box and check that the plan changes and the session was resumed. Then reject one plan, and
   run one with auto-approve on.
5b. Set the dogfood project to `push` (a local bare repo as `origin`, never a real remote). Check that the plan lands
   on `main` and is pushed. Then repeat with a dirty project folder and check that it escalates and touches nothing.
6. File every failure as a GitHub issue (repro, expected, actual, file:line guess) labelled `wave-6`, and write the
   Wave 8 prompts the way `d5eb889a` wrote Wave 5's.
7. Append measurements and the new day-to-day flow to `LINUX.md` and `USAGE.md`. Open a PR; do not merge.
