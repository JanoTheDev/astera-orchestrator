# W13 plan tab shots

The `view:plan` editor tab and its Plan settings after the Task "Plan editor tab and Plan settings". Taken from
`npm run dev` (through `astera heavy`) on a temporary profile seeded with `node scripts/shots-seed.mjs`, driven over
CDP. Sizes 1440x900 Night and Day, 1024x640 Night (the side bar hidden with Ctrl+B, since under 1100px it lies over
the editor): `<size>-<theme>-<NN>-<what>.png`.

| # | File suffix | What it shows |
|---|---|---|
| 01 | `paused-plan-question` | Plan "Dark mode toggle", paused, with its open question: the header (status word, "Step 2 of 3 · 1/4 done", progress Meter, Resume, Open consoles, the ⋯ menu), Needs you with the answer box, the Goal and the Steps. |
| 02 | `steps-working-task-expanded` | The Steps as a vertical list of collapsible steps; the working Task "Wire the toggle into the header" (dispatched, held by the pause) expanded inline to its checks and changes. |
| 03 | `plan-settings` | Plan settings of the paused plan: workers at once (changed to 5 in the app before the shots), priority, review rounds, replan, auto-approve, hands-off, delivery. Delivery is read-only with "Delivery has started.": the seed presets this Run's delivery state to `pending`, which `editableSettingsOf` counts as started. |
| 04 | `finished-plan` | Plan "Settings page", failed delivery: the status word, the "Not delivered" chip, the failed Task's row with its reason. |
| 05 | `finished-plan-settings-readonly` | The finished plan's settings: every field read-only, each saying "This plan has finished; its settings no longer change." |

## Checked live in the same run

- Workers at once 2 → 5 on the paused plan (type, Enter): the toast said "Saved. Applies to agents that start from
  now on.", and `astera jobs get --id job_5eed000000000002` (same profile) answered `"concurrency":5`.

## Not shown

- A plan with live agents: the seed starts no agent. The paused plan's dispatched Task stands in for a running one
  (its "Open console" link shows only for a running Task whose console tab is open).
