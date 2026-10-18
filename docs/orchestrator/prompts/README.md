# How to run these prompts

1. Open a Claude Code tab in `/home/jonx/Desktop/Astera` for each prompt.
2. Paste: `Follow docs/orchestrator/prompts/<FILE>.md exactly.` (or paste the file's contents).
3. Each wave runs in parallel; after all PRs of a wave are open, run `MERGE.md` in one tab.
4. Load: parallel tabs share one laptop. Full test runs are queued through
   `flock /tmp/astera-fullsuite.lock` with 2 workers (CONTEXT.md rule 4), so only one runs at a time.
   Don't run `npm run dev` yourself while the tabs are testing.
5. Job workers stop at Claude permission prompts by default (CONTEXT.md rule 7). For unattended runs, enable
   Settings → "Run agents without permission checks".

Status: Wave 0 merged (PR #25), Wave 1 merged (PRs #26–#29), 2026-10-17. See `docs/orchestrator/LINUX.md`.

| Order | Tabs (parallel) |
|---|---|
| Wave 0 | W0-linux-baseline-and-security |
| merge | MERGE |
| Wave 1 | W1-A-role-models · W1-B-global-scheduling · W1-C-plan-lifecycle · W1-D-linux-background |
| merge | MERGE |
| Wave 2 | W2-A-planner-stage · W2-B-workspace-sidebar · W2-C-plan-board · W2-D-github-links |
| merge | MERGE |
| Wave 3 | W3-A-activity-feed · W3-B-command-and-voice · W3-C-search-and-inbox · W3-D-routing-recovery-tests |
| merge | MERGE |
| Wave 4 | W4-final-linux-verification |
| Wave 5 | W5-A · W5-B · W5-C · W5-D |
| merge | MERGE (PR #57 still open) |
| Wave 6 | W6-A-intake-and-github · W6-B-autopilot-answers-and-sound · W6-C-scheduler-guards · W6-D-wave-replanning · W6-E-progress-view · W6-F-project-workspaces · W6-G-usage-guards · W6-H-delivery-modes |
| merge | MERGE |
| Wave 7 | W7-A-plan-feedback · W7-B-projects |
| merge | MERGE |
| Wave 7V | W6-V-autopilot-dogfood (alone; covers W6 + W7) |
| Wave 8 | W8-A-commit-attribution · W8-B-line-attribution |
| merge | MERGE |

Owner decisions baked in (2026-10-17): Claude-only accounts for now (Codex later), mixed models by task difficulty, one PR per plan, local whisper.cpp for voice.
