You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md (especially "Wave 6 — Autopilot" and its contracts), docs/guide.md
and the SPEC.md sections named below. Inspect the existing code named here before writing anything. Extend
existing code; do not build parallel systems. Use the Wave 6 contract names exactly as PLAN.md spells them.

Worktree + branch (rule 1 in CONTEXT.md): slug `w6-usage`, branch `feat/orch-usage-guards`.

SPEC sections: §2, §3, §9.

# W6-G — Usage guards: at most 10 subagents per tab, no new workers when the account is nearly spent

Autopilot opens up to 10 tabs, and each Claude tab can fan out subagents. Usage must stay under control without the
owner watching.

Read first:
- `core/sessions/statusline.ts`: the per-session `--settings` file whose `hooks` every Claude session Astera spawns
  gets (SessionStart, Notification, the tool pair). Note that those hooks are async capture hooks.
- `core/usage/statusline.ts`: `rate_limits.five_hour` / `seven_day` `used_percentage` and `resets_at`, per
  session.
- `exec/limitProbe.ts` and `core/rolling/*`: today a limit is handled only *after* a worker dies on it, and rolling
  moves a session to another account. Extend these; do not duplicate them.

1. **Subagent cap per tab** (every Claude session Astera spawns, workers and plain tabs):
   - Add a **synchronous** PreToolUse hook with matcher `Agent|Task`, plus SubagentStop, to the session settings.
   - The command is a small node script shipped like the existing capture script. It keeps a per-session count in
     the session's hook dir: +1 on PreToolUse for `Agent`/`Task`, −1 on SubagentStop, never below 0.
   - At the cap, it denies the call. Use the documented PreToolUse JSON output `permissionDecision: "deny"` with
     the reason "Astera: N subagents already running in this tab (limit N). Wait for one to finish." Verify the
     output format against the installed Claude Code's hooks docs.
   - A crashed tab's stale count resets when the session starts (SessionStart).
   - App setting `maxSubagentsPerSession`, default 10, range 1–10.
   - Pure counting logic in new `core/sessions/subagentCap.ts`, with tests: cap, decrement, a stray SubagentStop,
     restart reset.
2. **Usage guard for new workers.** New pure `core/orchestration/usageGuard.ts`:
   - Given the latest `rate_limits` of the account a Dispatch would start on, a new Dispatch does **not** start
     when `five_hour` or `seven_day` `used_percentage` ≥ `usagePauseAt` (app setting, default 90).
   - Exception: rolling has another account in the chain under the threshold. Then start on that one, using the
     existing rolling account choice.
   - Running workers are never stopped.
   - Hook it into `exec/dispatchLoop.ts` before a worker starts (additive; W6-D also touches this file).
   - `blocked.ts` gets the reason "paused: account at 93% of its 5-hour limit, resumes ~14:20" (additive; W6-C
     owns it).
   - Emit `usage.paused` / `usage.resumed`. Show them as a feed line and a desktop notice, without the W6-B chime:
     nothing is needed from the owner.
   - Resume on its own when a fresh statusLine reading is under the threshold or `resets_at` has passed.
   - Unknown usage (no reading yet) does not block.
3. **Visibility.** A small usage strip on the plan view, a new `components/usage/UsageStrip.tsx` mounted
   additively:
   - per account: 5-hour and 7-day percentage with the reset time
   - live subagents per tab
   - the threshold
   Settings UI for the two settings next to the existing worker cap.

Ownership: see the W6-G row of PLAN.md.

## Done means
- Every item above works and is covered by a test that fails without it.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately). Do not start the app, `dist:linux` or a full suite while another tab
  runs one (CONTEXT rule 7; the laptop has crashed from this).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
