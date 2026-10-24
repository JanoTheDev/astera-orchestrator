# Switch benchmark: AFTER numbers

| | |
|---|---|
| Date | 2026-10-24 |
| Commit | 4316df8f (branch `JanoTheDev/After-numbers-and-final-proof`, merged fixes; only `scripts/perf-switch.mjs` differs) |
| Machine | AMD Ryzen 7 5800H with Radeon Graphics, 16 threads, Linux 6.14 |
| Mode | same as before.md: `npx electron-vite build`, then `electron . --remote-debugging-port=9361` on the throwaway profile (production renderer, Chrome 146, viewport 1920x1047, `long-animation-frame`) |
| Seed | `shots-seed.mjs --scale`, same as before.md (75 plans over 5 projects, 657 Tasks, 943 Dispatches, 3362 messages, 1440 Deliveries, 185 Gates, 325 transcripts) |
| Runs | 5 per target after 1 warm-up; 8 plan tabs for Tab switch. State push: 62 fired, 60 answered, 0 failed |

Times in ms; raw data `after.json`, procedure `README.md`. Targets: view and tab switch < 100 first paint, project switch < 300, no frame > 50, last click wins 100%. "Settled" is the unchanged before/after predicate; a "met" in the settled column uses the same < 100 / < 300 limit for comparison only (the target is first paint).

| Target | First paint before (med / p95) | First paint after (med / p95) | Settled before (med / p95) | Settled after (med / p95) | Target | First paint met | Settled < limit |
|---|---|---|---|---|---|---|---|
| Plans | 17.6 / 17.9 | 18.2 / 18.6 | 181.9 / 267.2 | 28.2 / 35.7 | < 100 | yes | yes |
| Sessions | 19.2 / 21.1 | 20.5 / 22.1 | 24.5 / 28.2 | 166.1 / 166.4 | < 100 | yes | no |
| History | 10 / 11.2 | 12.3 / 14.3 | 665.6 / 693 | 24.8 / 29.8 | < 100 | yes | yes |
| Run | 10.4 / 12.5 | 10 / 27.1 | 156.1 / 162.1 | 11 / 35.9 | < 100 | yes | yes |
| Source Control | 10.1 / 11.6 | 12.4 / 16.3 | 155.8 / 160.8 | 12.8 / 23 | < 100 | yes | yes |
| Devices | 9.3 / 10.6 | 15.3 / 23.4 | 160.1 / 160.5 | 21.1 / 50 | < 100 | yes | yes |
| Settings | 18.1 / 21 | 26.1 / 29.4 | 162.3 / 165.4 | 161.9 / 165.7 | < 100 | yes | no |
| Tab switch | 16.8 / 18.1 | 82.6 / 97.8 | 86.4 / 95 | 369.9 / 505.9 | < 100 | yes (p95 97.8) | no |
| Project switch | 14.7 / 15.2 | 15.8 / 28 | 190.8 / 192.8 | 164.9 / 233.3 | < 300 | yes | yes |
| Open plan | 14.2 / 15.5 | 13.3 / 17.9 | 89.8 / 182.5 | 104.6 / 237.3 | < 100 | yes | no |
| Main plan | 37 / 40 | 137.8 / 180.2 | 37 / 397.8 | 171.6 / 206.6 | < 100 | **no** | no |
| New plan | 12.9 / 13.7 | 14.3 / 15.9 | 51.7 / 54.3 | 63 / 84.4 | < 100 | yes | yes |

## Frames over 50 ms (target: none) and last click wins (target: 100%)

| Target | Longest frame before → after, ms (count) | Last click wins before → after | + state push before → after |
|---|---|---|---|
| Plans, Sessions, History, Run, Source Control, Devices, Settings, New plan | 0 (0) → 0 (0) | 5/5 → 5/5 | 5/5 → 5/5 |
| Tab switch | 0 (0) → **148.9 (6)** | 5/5 → 5/5 | 5/5 → 5/5 |
| Open plan | 0 (0) → **80 (1)** | 5/5 → 5/5 | 5/5 → 5/5 |
| Main plan | 0 (0) → **164.1 (3)** | 5/5 → 5/5 | 5/5 → 5/5 |
| Project switch | 0 (0) → 0 (0) | **0/5 → 0/5** | **0/5 → 0/5** |

## Content ready (new column, not in before)

For Sessions, Run, Source Control and Devices "settled" stays the old predicate (`true`, DOM quiet only). The content-ready column is the click until the visible sidebar view has drawn its rows or empty state with no "Loading"/"Scanning". Before: not measured.

| Target | Median | p95 |
|---|---|---|
| Sessions | 20.5 | 22.1 |
| Run | 10 | 27.1 |
| Source Control | 12.4 | 16.3 |
| Devices | 15.7 | 36.7 |

The seed has no sessions, run configurations or worktrees, so Sessions, Run and Source Control draw an empty state; these numbers say nothing about large lists.

## Sessions with 30 open sessions: not measured

`--sessions N` is implemented in `scripts/perf-switch.mjs` but no agent-free session path exists, so the "after, 30 shell sessions" row is missing:

- `sessions.spawn` (ipc handler in `src/main/ipc.ts`) always ends in `SessionManager.spawn` (`src/core/sessions/manager.ts`), which runs `d.buildCommand`, i.e. the provider CLI (`claude`/`codex`). There is no shell kind. Project terminals (`core.terminal.open`) are plain shells but are not listed by the Agents view (`allSessions` = `core.sessions` + `core.chat`).
- It needs an account: `chooseResumeStart` refuses the seeded `shots-seed` account ("it is not logged in") unless `<configDir>/.credentials.json` exists. An empty file in the throwaway config dir passes the check.
- A stub `claude` (`exec sleep`) first on PATH is not used: the Host's PATH starts with `~/.local/bin` (the real `claude`), also when started as `env PATH=<stub>:$PATH electron .`. With the credentials file, `--sessions` therefore started real `claude` processes (killed again at once; nothing was measured with them). To use `--sessions 30`, put a stub `claude` ahead of the real one on the PATH the Host sees.

## What changed (and what it moved)

- SWR read cache (`lib/readCache.ts`) in Plans, Run, History, Source Control, Settings, Devices and others, plus kept-mounted views (React Activity): History settled 666 → 25, Plans 182 → 28, Run / Source Control / Devices 156-160 → 11-21. The ~150 ms plateau is gone for those views.
- Owner-wins state (`state/selection.ts` OwnerPick, sidebar view single source of truth): last click wins stays 5/5 everywhere except Project switch (below).
- Frame-coalesced pushes, memoised data, deduped polls, virtualised lists: no frame over 50 ms in any view switch.

## Not met

- **Main plan first paint < 100**: median 137.8 / p95 180.2 (before 37 / 40). 3 of 5 runs have one long frame of 124-164 ms (the runs at 27 ms and 26 ms have none). Cause not traced (no CDP performance trace taken); the pattern suggests the first render of the Main plan tab body, now done in the click's frame, not a push.
- **Tab switch frames over 50 ms**: 6 long frames, longest 148.9 ms, in 3 of 5 runs (first paint 83, 84, 98); the other two runs: 18 and 17 ms, no long frame, settled 118-136. Before: 0 long frames, first paint 17. A plan tab that is switched to is rendered during the click (two frames of 54-99 ms, then one of 124-149). Settled is 370 median (before 86). Not traced.
- **Open plan**: one long frame of 80 ms (the first run, settled 237); other runs 76-109. Not a listed target.
- **Sessions and Settings settled** stay at ~162-166 (the old plateau) while their first paint and content are early (Sessions content ready 20.5); something mutates the DOM ~150 ms after the click. Not a target miss (first paint is < 100); Sessions settled went up from 24.5.
- **Project switch last click wins 0/5, 0/5 with push**: the second click does not reach a switcher item. The pointerdown log (`downs` per run in `after.json`) shows B's pointerdown lands on `welcome` (the editor background) in 10 of 10 runs, while the switcher popup is still in the DOM; in 9 of 10 the title bar already shows `acme` (A applied) when B lands, in 1 it still showed the old project. So it is cause 1, B's click landing off the switcher item (the popup's items move or close under the pointer after A), not cause 2 (A overwriting B): B never selects anything. The gap between the two pointerdowns is 40-120 ms, not 30, because of CDP round trips; the script's timing and predicate are unchanged.

## Checks

- `npm run typecheck`: passes.
- `npx vitest run --maxWorkers=2` (full): 6 files / 11 tests failed in the first run, 7 files / 12 in a second (flaky between runs); none in files this plan touches. Repeated on the 7 files alone: all 12 fail again:
  - `src/core/sessions/sessionContext.test.ts` (6): expected strings differ from what the hook prints inside an Astera session (this session's `ASTERA_*` environment; likely environmental).
  - `src/host/sessionEvents.wiring.test.ts` and `src/core/log/logSites.test.ts` (1 each): both read the `const leave = (why?: string)` block of `host/index.ts` and find nothing there.
  - `src/main/lineNumberCitations.test.ts` (1): two citations by line number in `src`.
  - `src/host/driving.test.ts` (B2 tick), `src/cli/cliHost.integration.test.ts` (stop vs state-put, 409), `src/renderer/src/components/plan/planBoardBudget.test.ts` (18.7 ms vs 16 ms frame budget): timing and load dependent.
  Not fixed here (outside the small-fix scope); the plan's delivery run should triage them.
