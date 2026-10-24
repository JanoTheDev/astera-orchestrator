# After shots (T19)

Taken in the **built** app (`electron-vite build`, started from `out/` with `--user-data-dir`), on a temporary profile
seeded with `scripts/shots-seed.mjs` (`/tmp/t19-shots-dev`), with real agent sessions on the owner's accounts. Files:
`<page>-<WxH>-<theme>.png`, themes night and day, sizes 1920x1080 and 1000x800, same names as `docs/shots/before/`.

- `start`, `switcher`, `mainplan`: `npm run shots -- --pages start,switcher,mainplan`, title bar on demo-app.
- `sessions`: `npm run shots -- --pages sessions`, title bar on All projects, with a live plan worker ("Add the docs
  note", api-server › Docs note), a plain console, a finished console ("Review console") and a failed worker ("Rebuild
  the search index", acme › Search index, red dot). `sessions-goto-plan-{1920x1080,1000x800}-night.png`: the worker row hovered, its
  actions shown (open to the side, Go to plan, stop); `sessions-goto-plan-opened-1920x1080-night.png`: the "Docs note"
  plan it opened.
- `history`: by hand over CDP (the shots script does not expand rows), All projects, All accounts (the owner's real
  `~/.claude*` and `~/.codex-accounts` dirs scanned), the live worker's folder (Docs-note, blue working dot, its plan
  on the second line) and api-server expanded: account chips and times on every row. The Work records pane is
  collapsed in these shots (see below).
- Extra: `accounts-merge-{before,dialog,refused,after}-1920x1080-night.png` (same-login merge in Settings › Accounts),
  `delivery-fallback-activity-1920x1080-night.png` (the plan log line of a delivery that fell back).

## start-*: New plan page
- **1000x800, the Plans side bar opens over the page**: by design, not changed. Under 1100px the side bar floats over
  the editor (`shell.css`, DESIGN-W13 §2). The page itself is whole behind it: a sweep from 900 to 1920px found no
  clipped text and no sideways scroll in the composer.
- **1920x1080, a narrow column, lower half empty**: fixed by T17's composer (one box with its mode row, starters and
  the settings summary that opens in place).
- **Mode row full width, attach hint truncated**: fixed. The mode is a short segmented control beside the primary
  button; the attach hint is the icon button's tooltip.

## sessions-*: Agents side bar
- **Empty state only (no signed-in account)**: fixed. The shots show live, idle, finished and failed rows.
- **1000x800, the side bar covers the editor**: by design (as above).
- **Welcome page "No plans in this project yet." beside a project with plans**: fixed (T19, `Welcome.tsx`: it reads the
  project's plans itself when the Plans view is not open).
- Found and fixed in T19 while shooting: rows overflowed the side bar and cut the place to "ap…" and the account to
  "jip.cl…"; finished planners had no time; the failed dot never showed (tab summaries were not routed to the Host).
  Each row is now two lines: title, account and time on the first, "project › plan" under the title on its own line,
  wrapping rather than cut. Only the title ends in an ellipsis. Model · effort steps back below a 300px side bar (it
  stays in the row tooltip) and shows when the side bar is wider.

## history-*: History sessions tree
- **Titles and the date column cut, status dots unlabeled**: fixed. The account chip and the time are never cut, the
  plan (when a session has one) goes on a second line, and the dot says its state in its tooltip and aria-label.
  Titles end in an ellipsis at 260px, which the rule allows for titles.
- **Project row "demo-app 10/24", a bare date**: changed to a relative time ("4m") with the live-session count badge;
  still no word beside it. Partly fixed.
- **Work records, an empty second pane taking half the side bar**: not fixed. It still opens at half height with
  "Nothing recorded yet".
- **Nothing opens a listed session**: fixed by T10 (a row opens its preview).
- Found and fixed in T19: the "load more projects" row read "Loading…" while nothing loaded (now "Show more").
- Left open: a plain console reads "finished" in History while it runs; only workers (through their Dispatch), resumed
  sessions and chats are matched to a live session (`historyTree.ts` `sessionFactsOf`). A chat the Host opened while the
  app runs is matched only after the app takes it over at its next start.

## switcher-*: project switcher
- **Title bar search field truncates at 1000px** ("Search or run a comm…"): fixed in T19. Under 1100px the key chips
  step back (the button's tooltip names the chord), so "Search or run a command" is read whole.
- **acme shows as one row, no sub-project, no counts**: fixed (T11). Sub-projects `web` and `ops` are listed under acme,
  each row has its status dot, branch and counts ("3 plans · 3 questions"), and a project with changes shows a
  "1 changed" badge that opens Source Control on it.

## mainplan-*: Main plan page
- **Words glued together** ("Add the settings formDone"): fixed (T4). Status chips stand apart from titles.
- **"Checks failed" with an hourglass and no explanation**: fixed in T19: the error icon in the danger colour, and
  why ("Checks failed: main moved on: origin/main has 2 commits this plan does not, and the push was refused").
- **1000x800, the side bar covers the page**: by design (as above).
- **1920x1080, counts far right, lower half empty**: partly. Running and waiting plans are expanded with their Task
  rows (status, account, model · effort), finished plans are one collapsed line with their Task count, commit and date;
  the counts stay right-aligned.

## Overlap and truncation check
No screen shows overlapping text, and no value other than a title is cut:
- Sessions and History rows: titles end in an ellipsis; the place ("project › plan") wraps on a second line; account
  chips, counts and times are whole.
- Plans side bar (in the start and mainplan shots): T19 reversed a8bc5d68's order. The status word ("Checking",
  "Stopped", "Failed") is never cut and the plan's name gives way. The description (step, counts, age) goes on a second
  line (`planTree.test.ts` now pins this order). The MAIN PLAN list cuts names only; its "2 of 3" counts are whole.
- Main plan page, switcher, New plan page (swept from 900 to 1920px): no clipped values.
- History's Work records pane (UnderstandingView, not changed here) clamps each record's message line ("No explanation
  account is set — pick one …"). It is collapsed in the History shots, and its clamped lines remain a truncation.
- Under 1100px the side bar floats over the editor (DESIGN-W13 §2), so at 1000x800 it covers the left part of the
  page behind it. The pages themselves have no clipped values.
