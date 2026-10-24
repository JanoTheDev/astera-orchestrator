# Switch benchmark

`scripts/perf-switch.mjs` measures how long Astera takes to switch views, editor tabs and projects, and to open a plan,
the Main plan and the New plan page. `before.md` / `before.json` hold the numbers from the code before the switching
fixes. The AFTER run must repeat the steps below exactly (same seed, same mode, same flags) so the tables compare.

## Never the real profile

Never start the app on `~/.config/astera`: it resumes real Jobs and spawns real agents. The benchmark uses a throwaway
profile, and the script refuses an app whose project is not one of the seeded ones.

## Steps

```bash
P=$HOME/.config/astera-perf          # the unpackaged app appends "-dev" to its userData: seed "$P-dev"

# 1. Seed (72 plans, ~650 Tasks, 940 Dispatches, 3360 messages, 1440 Deliveries, 185 Gates, 5 projects, 325 transcripts).
#    Quit the app and stop that profile's Host first.
node scripts/shots-seed.mjs --profile "$P-dev" --scale

# 2. Build the production renderer, then start the built app with a CDP port.
astera heavy -- npx electron-vite build
ASTERA_PROFILE_DIR="$P-dev" SHELL=/bin/bash astera heavy -- env -u ELECTRON_RUN_AS_NODE -u ASTERA_SESSION \
  node_modules/electron/dist/electron . --remote-debugging-port=9361 --user-data-dir="$P"

# 3. Measure (about 10 minutes; do not touch the app meanwhile).
node scripts/perf-switch.mjs --port 9361 --profile "$P-dev" --runs 5 --out docs/perf/after.json

# 4. Close the app and stop the Host.
ASTERA_PROFILE_DIR="$P-dev" ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron out/main/cli.js host stop
```

Then check `pgrep -af "astera-perf"` is empty.

## Mode

**Built app run directly with Electron** (`electron . --remote-debugging-port`), i.e. the production renderer (no
StrictMode double effects, minified bundle). `electron-vite preview` was tried first: it has no `--remoteDebuggingPort`
option (`Unknown option`), and `electron-vite dev` runs the dev renderer under StrictMode, so it was not used. The window
is the default one (maximized, 1920x1047 here); the viewport is recorded in the JSON.

## What the numbers mean

For each target the script does 1 unrecorded warm-up run, then `--runs` (5) runs, each from a settled other view
(editor tabs closed, 400 ms without DOM mutation). The click is a real mouse event over CDP; all times are measured in
the page with `performance.now()`, from the click's `pointerdown`.

| Column | Meaning |
|---|---|
| First paint | click to the end of the frame after it (two `requestAnimationFrame`). Always at least one frame; it does not say the content is there. |
| Settled | click until the target's ready predicate is true (content drawn, no "Loading"/"Scanning") **and** the DOM has not mutated for 300 ms, minus those 300 ms. Never below first paint. |
| Longest frame (count) | `long-animation-frame` entries (>50 ms) between the click and "settled": longest, and how many in all runs. Falls back to `longtask`. |
| Last click wins | click A, 30 ms later click B, wait until the DOM is quiet (at least 800 ms): the visible selection must be B. Pass/total. |
| Last click wins + state push | the same, with an orch command (`jobs-rename` on a seeded plan, fired right after A) so the Host pushes state while the clicks are in flight. |

Targets and what A, B and "from" are:

- **Plans, Sessions, History, Run, Source Control, Devices**: activity bar click, from Agents (Sessions: from Plans). A is another view.
- **Settings**: the Manage menu is opened first; the timed click is its "Settings" item. For last-click-wins A is the Settings item and B the Plans view.
- **Tab switch**: `--tabs` (8) plan tabs are open; the click is on one of the first two, alternating. A is the third tab.
- **Project switch**: Plans view, the title-bar switcher is opened first; the timed click is the other project of `demo-app` / `api-server`. A is `acme`.
- **Open plan**: from Plans, a plan row of the sidebar (a different plan each run). A is the first plan.
- **Main plan / New plan**: the sidebar's "Open main plan" / "New plan" button; A is the other one.

Raw JSON (`--out`): `meta` (machine, commit, viewport, state pushes fired), `summary`, and every run under `results`.
`--only "Tab switch,History"` runs a subset.

## Caveats

- `windows.json` holds windows only, not tabs, so tabs are opened through the UI by the script.
- No live agent session is open (that needs a signed-in account), so Tab switch uses plan tabs.
- The first History open scans the transcripts; the warm-up absorbs it, so History numbers are for a warm scan.
