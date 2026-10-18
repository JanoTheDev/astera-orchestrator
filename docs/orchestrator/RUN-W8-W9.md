# Run order for W8 + W9 (one Astera plan)

Paste the block below into the Start page's **Instructions** box (or `jobs create --instructions -`). Do not attach
this file: in Run as written every attached file becomes a Task.

Attach these 16 prompts from `docs/orchestrator/prompts/`: W8-A, W8-B, W8-D, W8-F, W8-G, W9-A, W9-B, W9-C, W9-D,
W9-E, W9-H, W9-I, W9-J, W9-K, W9-F, W9-G.

```text
Run these prompts as five waves. A wave starts only when every Task before it is done, reviewed and merged into
this plan's branch.

Wave 1 (parallel): W8-A, W8-B, W8-D, W8-F, W8-G.
Wave 2 (alone): W9-A. Depends on all of wave 1. No other Task runs while it does.
Wave 3 (parallel): W9-B, W9-C, W9-D, W9-E, W9-H, W9-I, W9-J, W9-K. Each depends on W9-A.
Wave 4 (alone): W9-F. Depends on all of wave 3.
Wave 5 (alone): W9-G. Depends on W9-F.

Already done, do not plan: W8-C, W8-E, W9-0.

A prompt saying "X is merged" means merged into this plan's branch. Ignore each prompt's own worktree, branch, push
and PR steps.
After wave 1, the replan adds one small Task if W8-B left its `shortcut: wire into stamp.ts after W8-A merge`: wire
it into W8-A's stamp.ts.
Every full test suite, dev-app run and AppImage build goes through `astera heavy`: never two at once.
Delivery: one draft PR, updated after each wave, marked ready after the final check. Never merge it.
```
