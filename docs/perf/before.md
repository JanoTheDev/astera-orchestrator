# Switch benchmark: BEFORE numbers

| | |
|---|---|
| Date | 2026-10-24 |
| Commit | 600f7cf5 (branch `JanoTheDev/Switch-benchmark-and-before-numbers`, no `src/` change) |
| Machine | AMD Ryzen 7 5800H with Radeon Graphics, 16 threads (`/proc/cpuinfo`), Linux 6.14 |
| Mode | production renderer: `npx electron-vite build`, then `electron . --remote-debugging-port=9361` (`electron-vite preview` has no CDP flag). Chrome 146, viewport 1920x1047, long frames from `long-animation-frame` |
| Seed | `shots-seed.mjs --scale`: 75 plans (72 + 3 small seed) over 5 projects, 657 Tasks, 943 Dispatches, 3362 messages, 1440 Deliveries, 185 Gates, 325 History transcripts. Projects shown: 17 plans in `demo-app` |
| Runs | 5 per target after 1 warm-up; 8 plan tabs open for Tab switch. State push: 62 fired, 60 answered, 0 failed (2 were the final reset) |

Times in ms. Raw data: `before.json`. Procedure: `README.md`.

| Target | First paint median (ms) | p95 | Settled median (ms) | p95 | Longest frame ms (count) | Last click wins | Last click wins + state push |
|---|---|---|---|---|---|---|---|
| Plans | 17.6 | 17.9 | 181.9 | 267.2 | 0 (0) | 5/5 | 5/5 |
| Sessions | 19.2 | 21.1 | 24.5 | 28.2 | 0 (0) | 5/5 | 5/5 |
| History | 10 | 11.2 | 665.6 | 693 | 0 (0) | 5/5 | 5/5 |
| Run | 10.4 | 12.5 | 156.1 | 162.1 | 0 (0) | 5/5 | 5/5 |
| Source Control | 10.1 | 11.6 | 155.8 | 160.8 | 0 (0) | 5/5 | 5/5 |
| Devices | 9.3 | 10.6 | 160.1 | 160.5 | 0 (0) | 5/5 | 5/5 |
| Settings | 18.1 | 21 | 162.3 | 165.4 | 0 (0) | 5/5 | 5/5 |
| Tab switch | 16.8 | 18.1 | 86.4 | 95 | 0 (0) | 5/5 | 5/5 |
| Project switch | 14.7 | 15.2 | 190.8 | 192.8 | 0 (0) | 0/5 | 0/5 |
| Open plan | 14.2 | 15.5 | 89.8 | 182.5 | 0 (0) | 5/5 | 5/5 |
| Main plan | 37 | 40 | 37 | 397.8 | 0 (0) | 5/5 | 5/5 |
| New plan | 12.9 | 13.7 | 51.7 | 54.3 | 0 (0) | 5/5 | 5/5 |

## Worst offenders

- **History** settles in 666 ms (p95 693): the scan and tree draw happen after the click. The worst view switch by far.
- **Project switch** settles in 191 ms (goal < 300), but **last click wins fails 5/5 (and 5/5 with a push)**: click `acme`, 30 ms later `api-server`/`demo-app`, and the title bar stays on `acme`. The second click lands on a popup that is already closing, or the first switch overwrites the second. Not told apart here.
- **Main plan** has the slowest first paint, 37 ms (p95 40), and one run settled in 398 ms.
- **Run, Source Control, Devices, Settings** all settle at 156-162 ms with a first paint of 9-18 ms: a fixed ~150 ms plateau (likely a transition or deferred render; cause not checked). Plans is 182 ms (p95 267).
- **Open plan** p95 183 ms and **New plan** 52 ms median.
- **Long frames: none** (0 entries over 50 ms in any run). First paint is already under 100 ms everywhere; the cost is in time to settled.
- Last click wins passes for every target except Project switch, with and without a state push. The push fires right after A and reaches the Host (60 of 62 answered), but 30 ms may be too early for the state event to land before B; the AFTER run uses the same timing.
