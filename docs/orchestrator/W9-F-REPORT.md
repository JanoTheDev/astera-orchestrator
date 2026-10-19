# W9-F — walk, fixes, screenshots (PR text)

Walked on the dev profile (`env -u ELECTRON_RUN_AS_NODE`, CDP, one Electron at a time) in Night, Dusk, Day and System (OS light), at 1440×900 and 1024×640. The redesign has no sidebar, so "narrowest sidebar width" became the 1024×640 minimum. Per page and state an automated pass recorded horizontal scroll, clipped or off-screen text and text under 3:1 / 4.5:1; Night, Dusk and Day sample screenshots were read by eye. Keyboard: Tab order and a visible focus ring were checked on the top bar, Agents, Tasks, Plans and Inbox (no element without a ring). Not checked: the PaneGrid split, voice, Browser/How It Works/History under More.

## Feature map (DESIGN.md §8) — what was checked
| Home | Result (4 themes × 2 widths unless noted) |
|---|---|
| Agents wall, strip, plan pills, full-size console | OK. Tile xterm clips its right edge by design (W9-H). Finished row / owner hold / "main" tile not seen live: the dev Host is an older build (`VERSION_MISMATCH` on `summaries`) |
| Tasks, Plan › Waves | OK; plan chip and filter pill overflowed → fixed; live line "Waiting for the heavy-job slot" seen |
| Plans, plan page, sections | OK; breadcrumb, header button and wave head fixed |
| Inbox: approval, question, handled | OK in real use (approval, answer to a coordinator question, feed lines); answer box restyled |
| Start, New | New opened the old session dialog → fixed; Start OK |
| Worktrees | Overlay stayed on top of every page → now a page |
| Files, Settings, search box | OK; Files with no session shows the consoles strip (left as is) |
| Status bar, usage meter, accounts | OK; top bar collided with window buttons at 1024 → fixed |
| Summaries, owner hold, auto worktree cleanup, attribution gutter | Not verifiable live (stale Host); code-level seams fixed below |

## Fixes
Wave-9.2 seams: done Task opens its summary (Overview) · "Its consoles" opens Agents filtered to the plan · `attribution-stats`/`blame` were CLI-only, so the renderer got 501: now answered in `ipc.ts` (touches `src/main/ipc.ts`, `src/core/attribution/cli.ts`, outside the listed paths) · branch link → `openWorktree` in the console details panel and plan board cards (not on Tasks-page cards: they are buttons) · InboxPage is mounted, no `InboxHost` left; "Move task into plan" still only opens Files · project settings selects styled · 100 i18n keys added (shell, attribution, inbox) in en/es/ja/ko, 13 unused rail/statusbar keys removed; `planBoard` age/ordinal short forms and the "Other" project row name are still English.
Walk fixes: Worktrees overlay → page · top-bar New → three-choice New · project name falls back to its folder · top bar collapses at ≤1100px, window buttons never overlap · Settings page and update gate inset 44px · Day repaints file-icon, git, syntax, PR and brand tokens (were <3:1) · plan zero counts, `.tb-slash`, Pause/Resume short label (full text in the tooltip) and hidden on a finished plan · breadcrumb ellipsis · wave head wraps · chips ellipsise · Inbox answer box.

## #106 (does not exist as a GitHub issue; from LINUX.md 7V re-run)
Board squeezed under planner box → fixed by W9-C (Waves is a full-width section). Plan view closing on a new tab → fixed by W9-B/C (plan page is a page; seen staying open as consoles started). One-letter tab labels at 16 tabs → fixed by W9-H (strip uses full labels, scrolls; not tried at 16). No feed line for a rejected plan → NOT fixed: no `plan.rejected` activity kind, filed as #111.

## End-to-end run (scratch repo, cleaned up)
Start (Plan it for me) → planner → Inbox "Plan ready" → Review plan → Approve & execute confirm → worker, reviewer, final check → plan completed, delivery line "no remote… git merge <branch>" in the feed. A second plan raised a real Inbox question (answered from the card), then waited on the heavy-job slot my own dev app held. Plans archived with `--kill-sessions`, worktrees and repos removed.

## Issues filed
#111 rejected plan has no feed line · #112 `runGitRecorder.test.ts` fails (host index has two `orch.ready()`, from crash-resume commit 9adbb6fe, not the redesign) · #113 plan title is the whole prompt.

## Tests
`npm run typecheck` clean. Full suite via `astera heavy`: 1 failed | 15976 passed | 69 skipped (955/963 files). The failure is `src/host/runGitRecorder.test.ts:294`, in untouched `src/host` (pre-existing, #112).
