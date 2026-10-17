# How to run these prompts

1. Open a Claude Code tab in `/home/jonx/Desktop/Astera` for each prompt.
2. Paste: `Follow docs/orchestrator/prompts/<FILE>.md exactly.` (or paste the file's contents).
3. Each wave runs in parallel; after all PRs of a wave are open, run `MERGE.md` in one tab.

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

Owner decisions baked in (2026-10-17): Claude-only accounts for now (Codex later), mixed models by task difficulty, one PR per plan, local whisper.cpp for voice.
