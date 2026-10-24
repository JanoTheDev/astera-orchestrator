# After shots (T19)

Taken in the **built** app (`electron-vite build`, started from `out/` with `--user-data-dir`), on a temporary profile
seeded with `scripts/shots-seed.mjs` (`/tmp/t19-shots-dev`), with real agent sessions on the owner's accounts. Files:
`<page>-<WxH>-<theme>.png`, themes night and day, sizes 1920x1080 and 1000x800, same names as `docs/shots/before/`.

- `start`, `switcher`, `mainplan`: `npm run shots -- --pages start,switcher,mainplan`, title bar on demo-app.
- `sessions`: `npm run shots -- --pages sessions`, title bar on All projects, with a live plan worker ("Add the retry
  note", api-server › README retry note), a plain console, the console chat, finished planners and a failed worker
  ("Rotate the API keys", red dot).
- `history`: by hand over CDP (the shots script does not expand rows), All projects, All accounts (the owner's real
  `~/.claude*` and `~/.codex-accounts` dirs scanned), demo-app and api-server expanded: account chips, a live session's
  dot, times on every row.
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
- Found and fixed in T19 while shooting: titles squeezed to "Add …" and a sideways scrollbar (the facts could not
  shrink), finished planners with no time, the failed dot never shown (tab summaries were not routed to the Host).
  Model · effort steps back below a 300px side bar (it stays in the row tooltip) so title, place, account and time fit.

## history-*: History sessions tree
- **Titles and the date column cut, status dots unlabeled**: fixed. One-line rows; the time is never cut (T19 fixed a
  row that pushed it out); the dot says its state in its tooltip and aria-label. Titles still end in an ellipsis at
  260px, which is the rule for titles.
- **Project row "demo-app 10/24", a bare date**: changed to a relative time ("4m") with the live-session count badge;
  still no word beside it. Partly fixed.
- **Work records, an empty second pane taking half the side bar**: not fixed. It still opens at half height with
  "Nothing recorded yet".
- **Nothing opens a listed session**: fixed by T10 (a row opens its preview).
- Found and fixed in T19: the "load more projects" row read "Loading…" while nothing loaded (now "Show more").
- Left open: a plain console reads "finished" in History while it runs; only workers (through their Dispatch), resumed
  sessions and chats are matched to a live session (`historyTree.ts` `sessionFactsOf`).

## switcher-*: project switcher
- **Title bar search field truncates at 1000px** ("Search or run a comm…"): not fixed.
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
No screen shows overlapping text. Truncation left: titles with an ellipsis (allowed), the title bar search placeholder
at 1000px (above), and the Plans side bar's status words ("Fail…", "Stop…"), which a8bc5d68 cuts before the plan name
on purpose (`planTree.test.ts` pins it).
