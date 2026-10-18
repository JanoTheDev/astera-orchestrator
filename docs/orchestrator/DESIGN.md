# Wave 9 design spec

Mockup (clickable, all four themes): https://claude.ai/artifact/DhSiAPZxCigXD4xJBoFb9x. It opens on the Agents
wall: click a tile to take it over, and use the filters to see Needs you and Finished. It has two artboards:
- "Astera — clickable prototype": the shell, the Agents wall, Home, a Plan tab, the Inbox, the search/command
  box, the New flow, Settings and the accounts popover. Its Tweaks switch the theme.
- "Themes, tokens and primitives".

Status: **decided** (2026-10-18, §13). Silence before 9.1 = approved. Once approved, every Wave 9 prompt builds against this file and the
mockup. Where they disagree, this file wins.

## 0. Hands-off first (owner, 2026-10-18)

Astera runs plans by itself. The UI exists so the owner can **watch everything at a glance, step in on any one agent
without disturbing the rest, and later read what each tab did.** Rules every screen follows:
- **The default view is the Agents wall (§3a).** It shows every CLI tab of the project, live, at once. Opening the
  app or switching projects lands there.
- **Nothing pops up by itself.** No modal opens unless the owner clicks. Only Inbox items (§2) notify, with sound.
  Auto-answers, merges and replans go to the feed, silently.
- **The owner never has to type into the coordinator.** They answer in the Inbox, or on a worker's tile. Typing into
  any tile never pauses or redirects the coordinator or other workers (§3a "The wheel").
- **Every finished tab leaves a summary (§3b).** Ended tabs close on their own (W7-F) and become summary cards. The
  scrollback stays one click away.
- **Defaults lean automatic:** auto-approve per project (W7-A) is offered on the first plan of each project, review
  is on, and replan between waves is on.

## 1. Layout

The window is 1440×900 in the mockup. The layout must hold down to 1024×640.

| Region | Size | Contents |
|---|---|---|
| Titlebar | 40px high | Left: the project switcher, showing the project's name and a "N waiting" chip; it opens the W6-F switcher menu. Centre: the search/command box button, 460px wide, which opens the box overlay. Right: the run config button, and one `Meter` for the active account's 5-hour usage, which opens the accounts popover. |
| Rail | 52px wide | Home, Inbox (badge = waiting count), Files, Worktrees, How It Works, then a spacer, then Settings. Icons are lucide at 20px, inside 40px buttons. The active button gets the `elevated` background. |
| Sidebar | 284px default, resizable 200–520px (`cm.sidebarWidth`) | Depends on the rail button; see §2. Pressing the active rail button collapses the sidebar (today's rule, `core/ui/sidebar.ts`). |
| Tab strip | 34px high | Every tab: plan, session, file, record, browser, app, media, settings. The active tab has a 2px accent line on top. Ended tabs follow the W7-F auto-close rule. The "All tabs" menu sits on the right. The W7-F quick switcher is unchanged. |
| Content | flex | The active tab. PaneGrid splitting works as today. |
| Bottom panel | resizable (`cm.runPanelHeight`) | Run output and terminals. Unchanged apart from tokens. |
| Status bar | 26px high | Running count · waiting count (opens the Inbox) · spacer · active account with its 5-hour and weekly usage (opens the accounts popover) · branch · host health (opens Settings › Advanced › Host when it is not ok). |

## 1a. Windows (W9-K)
- Each project can have its own window, so two or three projects can run side by side on separate monitors.
- They are all windows of **one app process and one Host**. Accounts, usage, rolling and the app-wide worker cap
  stay single, and nothing is counted twice.
- Open a new window from the project switcher's "Open in new window", `Ctrl+Shift+N`, the tray, or by launching
  again with `--project <name>`.
- A window shows only its project (the W6-F scope). Its title is "<project> — Astera".
- Notices open their project's window.
- The windows open at quit come back on launch. Closing the last window keeps plans running in the background
  (W1-D).

## 2. Rail views

**Home:**
- Header: the project name, and a "New" primary button that opens the New flow.
- Sections, each built on `Section` (collapsible, state kept in `cm.section.<id>`):
  - **Plans**: open by default. The tree is Project → Plan → Planner / Coordinator / Workers (W2-B, W6-F).
    - A plan row shows its progress (`5/9`) or its state (`approve`, `done`), plus a status dot.
    - A worker row shows its Task and its live state (`editing`, `asks`, `permission`, `review`).
    - Clicking a plan opens its Plan tab. Clicking a session focuses its tile on the Agents wall.
    - Archived plans sit in a "Done" sub-group, closed by default.
  - **Sessions**: tabs that belong to no plan.
  - **History**.
- Accounts no longer have a sidebar section. They live in the popover and in Settings › Accounts & usage.
- The search box and the "needs input" badge leave the Workspaces header. Search moves into the box (W9-D) and the
  badge moves onto the rail.

**Inbox:**
- **Needs you**, oldest first. Each card shows a kind chip, the age, "project › plan › task", and the text. Answers
  happen inline:
  - Question (`astera ask`, escalation): quick-answer buttons when the asker offered options, a text box, and
    "Send to <worker>" (the W7-C answer box).
  - Plan approval: Review plan (opens the Plan tab) · Talk to planner (opens Overview) · Approve.
  - Permission wait: "Open tab to answer". Permission prompts stay human and are answered in the terminal
    (CONTEXT rule 6).
  - Give-up or escalation after the review cap: Open plan · Retry task · Skip task.
- **Activity**: the W3-A feed, newest first. Auto-answers appear here and never under "Needs you".
- The desktop notice, the chime's notice click, the rail badge and the status-bar count all call `openInbox()`.

**Files:** the existing explorer (`FileExplorer`), unchanged apart from tokens.

**Worktrees** (W9-J):
- The sidebar lists every worktree of the project, grouped:
  - one group per running plan, for the Task worktrees in use;
  - **Ready to clean up**, for merged Tasks with no session, a clean tree and nothing unpushed;
  - **Yours**, for worktrees Astera did not create.
- Each row shows the branch, ahead/behind, its agent, and dirty state.
- "Clean up N" removes the ready ones in one click, using the existing `remove.ts` path and its checks.
- Clicking a row opens its **Worktree tab** (`worktree:<path>`). The tab shows:
  - Header: the branch, a state chip, base, ahead/behind, and the actions Show its agent (focuses the wall tile),
    Open session here, Open in Files, and ⋯ (push, create PR, remove, copy path).
  - Fact cards: agent and Task, folder, working tree, and PR (or "goes into the plan PR #N").
  - **Changes vs base**: a file list with M/A/D and +/−. Clicking a file opens `DiffView` with the W8-B blame gutter.
  - **Commits** since base, each with its author (agent and model, from W8, or "you").
- **Hands-off:** worktrees of merged Tasks are removed automatically once the plan is delivered. Only those with a
  clean tree, nothing unpushed and no session qualify; the rest wait under "Ready to clean up". A setting turns this
  off, and it is on by default. **"Yours" is never removed automatically.** Every removal keeps the existing
  dirty-tree confirmation and branch-preserved rules.
- The wall's tile footer and the Plan board card show the worktree branch as a link to its Worktree tab.

**How It Works:** the existing `UnderstandingView`, unchanged apart from tokens.

**Settings:**
- The sidebar holds a search field and the 7 groups. The content area is a **Settings tab**, not a modal, so it can
  sit beside a terminal and the box can deep-link into it (`openSettings(group, anchor)`).
- One Settings tab exists at most; opening Settings again focuses it.

## 3a. The Agents wall (the main view)

- A pinned first tab, **Agents · N**. N is the number of live CLI tabs in scope. The tab can't be closed.
- **Toolbar:**
  - Scope: This plan / <project> (default) / All projects.
  - Filter: All / Needs you / Running / Finished.
  - An autopilot line saying what the coordinator is doing for you.
- **Tiles** in an auto grid: 1–4 tabs → 2 columns, 5–9 → 3, 10+ → 4. Every CLI tab in scope gets a tile: planner,
  coordinator, workers, reviewers, and plain sessions. Order: needs you first, then running, then idle.
  - **Header:** role, Task, and a state chip (Editing / Asks you / Permission / In review / Idle / Done). It also
    shows a status dot, and a warn or danger border while the tab needs you.
  - **Body: the real terminal**, live. Each tile is the session's own xterm, sized to fit at 11px font and read-only
    until focused. Offscreen tiles stop rendering. If 12 live tiles cost too much CPU on the owner's laptop
    (measure: no more than 15% of one core while idle), tiles fall back to the last 6 lines of text, and only the
    focused tile keeps a live xterm. W9-H measures this and records the numbers in its PR.
  - **Footer:** model and account, a "Send a line to <name>" box (sends one line without taking over), and Take
    over.
- **Take over** (click a tile, or ⤢): the tile grows and gets keyboard focus, so typing goes straight into that
  session's PTY. A banner says "You are typing to Worker 3 · T5. The coordinator's messages to it wait until you
  hand back."
  - Esc or "Hand back" returns. "Open as tab" moves the tile into a full tab.
  - Taking over never pauses the plan, the coordinator or any other tile.
- **The wheel** (owner-input hold):
  - While the owner holds a session, an agent's `sessions-send` into it is queued in the Host, not typed. This stops
    a coordinator message from landing in the middle of the owner's line.
  - The hold starts on the owner's first keystroke in that session, or on Take over. It ends on Hand back, or after
    60 s with no owner input.
  - The sender gets `{ queued: true, reason: 'owner-typing', target }` at once, so the coordinator never blocks on
    it. Queued messages are delivered in order when the hold ends.
  - Permission prompts are unaffected: the owner answers them by typing, as today.
- **Finished row:** below the tiles. It holds the summary cards (§3b) of tabs that ended in scope, newest first, with
  Scrollback (opens the read-only scrollback) and Changes.
- Clicking a session in Home › Plans, in an Inbox card or in the box focuses its tile on the wall. "Open as tab"
  stays available everywhere.

## 3b. Tab summaries

- **When:** a CLI tab ends (process exit, Task merged or given up, or W7-F auto-close). A plain session also gets
  one when it has been idle at a finished turn for 10 min and wrote something. Turning this off is a setting; it is
  on by default.
- **What:** a short card made of facts Astera already has, plus 2–3 sentences written by a cheap model.
  - Title: role and Task.
  - Outcome: Merged / Merged · N rounds / Gave up / Stopped / Done.
  - Duration and when it ended.
  - Facts:
    - Files touched with +/− (git diff, or W8 attribution).
    - Checks the agent ran and their result (`SessionWorkUnit.checks`).
    - Reviewer rounds and the verdict.
    - Questions asked and who answered them.
    - Commits or PR.
  - Prose: what it did and anything left open. It is written by the coordinator role's model (haiku by default), from
    the facts, the agent's own `resultSummary`, and the session's last messages. It runs through the existing How It
    Works generator path (`core/understanding`), not a new agent runner.
- **Where it shows:**
  - The wall's Finished row.
  - The Task's card on the board.
  - The session's History row.
  - Hover on a finished tree row.
  - The plan's end: all of a plan's summaries roll up into the plan summary in Overview, and into the delivery PR
    body (W6-H) under "What each task did".
- **Storage:** next to the session record in the Host's store, as
  `SessionSummary { sessionId, jobId?, taskId?, at, outcome, durationMs, facts, text, model }`.
  - Only ids and facts are stored. There is no prompt text beyond what the session store already keeps.
  - Nothing goes into git except the PR-body roll-up, which is part of a delivery the owner set up.

## 3. The Plan tab (`plan:<jobId>`)

- **Header:**
  - The title, which can be renamed inline (W1-C).
  - State chips: Running / Paused / Planning / Awaiting approval / Done, wave X of Y, done/total, delivery.
  - Actions: Pause/Resume · Talk to planner · ⋯ (rename, priority, workers at once, hold, archive, kill sessions, open
    PR).
- **Sections** (a segmented control; the last one used is remembered per plan):
  - **Overview**: objective, source chips, existing.md summary, "Talk to the planner" (W7-A thread, box and Send),
    the approve bar while awaiting approval, "How it runs" (models, workers, review, final check, delivery), the
    plan's usage (W6-G strip as `Meter`s), the final check result (W7-E), and gates (`GateAnswer`).
  - **Board** (opens first while running): one column per wave, showing title, state chip and count. The current wave
    is marked. "Replanning wave N…" appears on the next wave while the planner works.
    - Cards show: id, title, status chip, live line (W6-E `lastAction`), files (two shown, then "+N more"), model and
      worker, and the answered-questions count.
    - A card that needs you gets the `warn`/`danger` border.
    - Clicking a running card opens its tab. Clicking a card that asks opens the Inbox on it.
    - A toggle swaps the board for the graph view.
  - **Files**: the W6-E files table. A file shared by two Tasks is marked "Shared · runs one at a time".
  - **Changes**:
    - A PR bar: number, state, checks, and AI/human share from W8.
    - A per-file list: +/−, Task, model, and AI share (W8 `attribution-stats`).
    - Clicking a file opens `DiffView` in a file tab, with the W8-B blame gutter.
  - **Journal**: `RunDetailJournal`, in mono.
- `RunDetail.tsx` and its modal are deleted. Every one of its controls has a home above; W9-C's PR lists them.

## 4. The New flow

- One `Modal`.
- **Step 1** picks between:
  - **Session**: agent, account, folder and worktree. This is `NewSessionDialog`'s form.
  - **Plan from a goal**: goal, workers at once, delivery and review, with defaults from the project page (W7-B).
    This is `NewPlanDialog`.
  - **Plan from a source**: GitHub issues, files or PDF, audit, or problem list, plus extra instructions. This is
    `SourceJobModal` and W6-A intake.
- **Step 2** shows the chosen form, with Back and a primary action ("Start planning" / "Open session").
- Entry points: Home's "New" button, the box (`new plan …`), and `Ctrl+N` (rebindable).

## 5. Search and command box

- One overlay, 620px wide, 56px from the top.
- Typing searches plans, Tasks and sessions across projects, including by initials (W3-C), grouped under Plans,
  Tasks, Sessions and Settings.
- When the text reads as a command, a "Commands" group shows the parsed intent (W3-B). Tab runs the text as a
  command, and destructive intents still ask for confirmation in the UI (CONTEXT rule 6).
- Holding `Ctrl+Shift+M` starts push-to-talk, as today.
- One key opens the box: `Ctrl+Shift+K`. The old search key becomes an alias.

## 6. Settings groups (every current setting → its group)

| Group | Settings (current tab in brackets) |
|---|---|
| General | Language, default session kind (general) · Theme, density, terminal font (appearance) · Shortcuts (shortcuts) |
| Accounts & usage | Accounts, sign in, remove, rolling (accounts) · Usage guard, subagents per tab (agent) |
| Agents | Role models (agent › OrchestratorModels) · Permission mode, max workers, resume strategy (agent) · Voice (agent) · Agent browser, agent app (agent) |
| Projects | One page per project (W7-B): delivery, auto-approve, test command, concurrency, review rounds, replan, account, line attribution (W8-B) · Add project |
| Integrations | GitHub (github) · Slack (slack) · CLI, MCP (cli) · Remote runtimes (remote) · Plugins (plugins) · Creative hub (creativeHub) |
| Notifications | Desktop notices, sound, digest (notifications) · Tab summaries on/off, summary model (new, W9-I) |
| Advanced | How It Works work unit and generator (hiw) · Worktree location (worktree) · History (history) · About, version, updates, host status (info) |

The settings search filters rows by label and description and shows the group each hit belongs to.

## 7. Feature map (one home per feature)

| Feature (wave) | New home |
|---|---|
| Every CLI tab at once, step in without disturbing the coordinator (W9-H) | **Agents wall** (§3a) · Take over · Send a line |
| What each tab did (W9-I) | Tab summaries (§3b): wall Finished row · board card · History · plan Overview · PR body |
| Sessions, PaneGrid, terminals (upstream) | Agents wall tiles · full tabs via "Open as tab" · Home › Sessions |
| Accounts, rolling, usage meters (upstream, W6-G, W7-F) | Status bar popover · titlebar `Meter` · Settings › Accounts & usage |
| Role models (W1-A) | Settings › Agents · Plan › Overview "How it runs" |
| App-wide cap, priority (W1-B) | Settings › Agents · Plan ⋯ menu |
| Plan rename, archive (W1-C) | Plan header · Plan ⋯ · Home › Plans "Done" |
| Linux background, tray (W1-D) | Unchanged (system tray) |
| Planner stage, approve (W2-A, W7-A) | Inbox approval card · Plan › Overview approve bar |
| Workspace tree (W2-B, W6-F) | Home › Plans · titlebar project switcher |
| Board, why waiting (W2-C, W6-E) | Plan › Board |
| GitHub links, PR (W2-D) | Plan › Changes · card chips |
| Activity feed, digest (W3-A) | Inbox › Activity · Settings › Notifications |
| Command bar, voice (W3-B) | The search/command box |
| Search, needs-input inbox (W3-C) | The box · Inbox › Needs you |
| Holds (W5-C) | Plan ⋯ · card menu |
| Intake, sources, GitHub assign (W6-A, W7-D) | New flow › Plan from a source |
| Auto-answers, escalation, sound (W6-B, W7-C) | Inbox · Settings › Notifications |
| Scheduler guards, same-file rule (W6-C) | Plan › Files "Shared" · card live line |
| Replanning (W6-D) | Board wave header · Journal · Plan › Overview talk |
| Project workspaces (W6-F) | Titlebar switcher · `Ctrl+Alt+1…9` |
| Several projects at once (W9-K) | One window per project: switcher "Open in new window" · `Ctrl+Shift+N` · tray · `--project` |
| Delivery modes (W6-H) | Plan header chip · Settings › Projects |
| Projects create/add (W7-B) | Settings › Projects · switcher "Add project" |
| Tabs auto-close, switcher (W7-F) | Tab strip · "All tabs" menu |
| Attribution (W8) | Plan › Changes · blame gutter in file tabs · Settings › Projects row |
| Explorer, editor, markdown, media (upstream) | Rail › Files · file tabs |
| Run configs, bottom panel (upstream) | Titlebar run button · bottom panel |
| Worktrees panel, PR/push badges (upstream) | **Rail › Worktrees** + Worktree tab (W9-J): changes, commits, agent, clean up |
| History (upstream) | Home › History |
| How It Works (upstream) | Rail › How It Works · record tabs |
| Browser pane, agent browser (upstream) | Browser tabs · Settings › Agents |
| Remote runtimes (upstream) | Settings › Integrations · runtime selector in the New flow |
| Plugins, MCP, CLI (upstream) | Settings › Integrations |
| Creative hub (upstream) | Settings › Integrations |
| Slack (upstream) | Settings › Integrations |
| Updates, host health (upstream, W0) | Status bar host · Settings › Advanced |
| First run (upstream) | `FirstRunDialog` on `Modal` |

## 8. Tokens

`styles/tokens.css` holds every value. Themes override only the colour group.

| Token | umbra (default) | vega | aurora | light |
|---|---|---|---|---|
| `--bg` | #0a0a0a | #17171a | #181b1a | #ffffff |
| `--rail` | #0a0a0a | #101013 | #141716 | #f1f1ef |
| `--panel` | #141414 | #1a1a1e | #1e2120 | #f6f6f4 |
| `--elevated` | #262626 | #23232a | #272a29 | #e8e8e4 |
| `--hover` (was `surfaceHover`) | #1f1f1f | #1f1f25 | #232726 | #eeeeea |
| `--term-bg` | #000000 | #141417 | #141716 | #fbfbfa |
| `--line` | #232323 | #0b0b0d | #252b2a | #dededa |
| `--text` | #fafafa | #d0d0d6 | #eceeed | #1c1c1f |
| `--text-dim` | #a1a1a1 | #93939e | #a1a5a4 | #55555e |
| `--text-faint` | #7c7c7c | #767682 | #7f8483 | #6f6f79 |
| `--accent` / `--accent-ink` | #4c7ef3 / #06122b | #37b0c4 / #0d2b30 | #7ccba0 / #14231a | #1f6feb / #ffffff |
| `--accent-soft` (new) | #16213d | #12303a | #1d3328 | #e3edfd |
| `--ok` / `--ok-soft` | #3fb950 / #12291a | #3fb950 / #14301f | #7ccba0 / #1d3328 | #1a7f37 / #e2f3e6 |
| `--warn` / `--warn-soft` (new) | #d6a03a / #2e2410 | #d6a03a / #2e2410 | #e0b04f / #2f2712 | #8a5a00 / #fbf0d9 |
| `--danger` / `--danger-bg` | #f0645b / #33181a | #e5534b / #3a1a18 | #ef6f66 / #361c1b | #cf222e / #fbe4e5 |
| `--status-bg` / `--status-ink` | #141414 / #a1a1a1 | #0e6478 / #d4f2f8 | #20744a / #e8f5ee | #f1f1ef / #3f3f46 |

Rules for the tokens:
- **Where the values come from.** The dark values are today's `themes.ts` values. `umbra`'s line changes from
  `rgba(255,255,255,.07)` to the solid #232323, so no colour literal is needed outside `tokens.css`.
- **What stays outside the themes.** The PR colours, `--agent-accent`, git colours and file-icon colours keep their
  current values and stay outside the theme pipeline (see the comments in `styles.css`).
- **Contrast.** `contrast.test.ts` must pass for every theme:
  - `--text-dim` on `--elevated` ≥ 4.5.
  - `--text-faint` on `--elevated` ≥ 3.
  - `--accent-ink` on `--accent` ≥ 4.5.
  - Chip text (`--ok`/`--warn`/`--danger`/`--accent`) on its `-soft` background ≥ 4.5.
  - W9-A adjusts any value that fails, and lists it in its PR.
- **Non-colour tokens:**
  - Font: Geist 13/400 for the UI and Geist Mono for code. Both are already bundled.
  - Type scale: 11 · 12 · 13 · 15 · 18.
  - Spacing: steps of 4.
  - Row height: 28.
  - Radius: per theme (umbra 8, vega 6, aurora 8, light 8).
  - Motion: 120–180ms with `--ease`, and none under reduced-motion.

**Theme ids:** `umbra` (default, as today), `vega`, `aurora`, `light`, and `system` (follows
`prefers-color-scheme`: light → `light`, dark → `umbra`). A saved `orion`, `antares`, `quasar` or `sirius` maps to
`umbra` on load.

## 9. Primitives (`components/ui/`)

| Primitive | Variants | States / behaviour |
|---|---|---|
| `Button` | primary, secondary (default), ghost, danger · sm 24 / md 28 | hover, focus ring, disabled, loading (spinner replaces the icon) |
| `Chip` | neutral, info, ok, warn, danger · optional dot | none |
| `Card` | plain, focus (accent border), need (warn border), danger | clickable cards are `<button>` |
| `Modal` | sm 440 / md 640 / lg 880 | backdrop, focus trap, Esc closes, `backdropProps` drag-safe close, returns focus |
| `Section` | none | collapsible header with chevron, label, count and action slot · persisted `cm.section.<id>` |
| `Tabs` | strip (tab strip), segmented (plan sections) | arrow-key navigation, `role="tablist"` |
| `Menu` | none | keyboard navigation, the "⋯" row menus, the project switcher, "All tabs" |
| `Field` | text, textarea, select, number, toggle | label, hint, error |
| `Meter` | none | thresholds: under 75 accent, 75–89 warn, 90+ danger (usage guard) · optional label |
| `EmptyState` | none | icon, one line, optional action |
| `Icon` | lucide names only | 14 / 16 / 20 |

The hand-drawn glyphs (`JobIcons`, `FolderGlyph`, `BranchGlyph`, `ResumeGlyph`, `UnderstandingIcons`, and the rail
SVGs in `App.tsx`) become lucide icons. `FileIcon` stays, because it uses file-type colours.

## 10. Dialogs → replacements

| Dialog | Becomes |
|---|---|
| `NewSessionDialog`, `NewRunModal`/`NewPlanDialog`, `SourceJobModal` | The New flow (§4) |
| `RunDetail` | The Plan tab (§3) |
| Settings modal (inline in `App.tsx`) | The Settings tab (§2, §6) |
| Pane grid as the landing view | The Agents wall tab (§3a); the pane grid remains for full tabs |
| `NewTaskModal`, `CreatePrDialog`, `ResumeDialog`, `LocalHistoryDialog`, `RemoteSessionsDialog`, `RunConfigManager`, `BypassRetryDialog`, `FirstRunDialog`, `ConfirmHost`, account add/import (`AccountPanel`), `HiggsfieldSettings` dialog, `HistoryBrowser` dialog, `BrowserPane` dialog | `ui/Modal`, same content |
| `CommandBar` | The search/command box (§5), also on `ui/Modal` (no backdrop dim) |

## 11. Pinned tests (keep the invariant, move the path)

| Test | Invariant | Moved by |
|---|---|---|
| `App.layoutWriteThrough.test.ts` | `setLayout`/`setActivePaneId`/`setSessions` are `writeThrough` memos, and refs are never assigned by hand | W9-A (follows the layout state hook) |
| `App.spawnUnattended.test.ts` | `spawn()` forwards the unattended policy | W9-A |
| `lib/folderLink.wiring.test.ts` | folder links are wired in App, BottomPanel, ConversationPane, FileExplorer, PaneGrid, RunPanel, TerminalBody, TerminalView | W9-A |
| `lib/openPath.test.ts`, `updateInstallPaths.test.ts`, `core/files/icons.test.ts` | they read `App.tsx` / `styles.css` text | W9-A |
| `JobsView.title.test.ts`, `SourceChip.test.ts`, `jobActions.holds.test.ts` | they read `RunDetail.tsx` | W9-C (repoint to `PlanTab`) |
| `FileExplorer.refresh.test.ts` | it reads FileExplorer and `styles.css` | W9-A |
| `core/orchestration/completionCss.test.ts` | `.detail-completion-*` max-height 160, overflow auto | W9-A (path), W9-C (selector) |
| `spinnerCss.test.ts` | `.job-arc`, `cm-spin` keep spinning under reduced motion | W9-A |
| `core/terminal/scrollbarCss.test.ts`, `shrinkCss.test.ts` | `.terminal-host` rules | W9-A |
| `core/theme/contrast.test.ts` | contrast ratios | W9-A (extended to every theme) |
| `styles.hiw.test.ts` | no colour literals in `.hiw-*`, and so on | W9-A (generalised to all renderer CSS) |

## 12. Migration (saved state keeps working)

| Saved | New |
|---|---|
| `sidebarPane: 'sessions' \| 'jobs'` | `'home'` |
| `sidebarPane: 'explorer'` | `'files'` |
| `sidebarPane: 'understanding'` | `'hiw'` |
| Worktree panel open state | dropped (the panel became the Worktrees rail view) |
| theme `orion`, `antares`, `quasar`, `sirius` | `umbra` |
| `cm.sidebarWidth`, `cm.runPanelHeight`, key overrides | unchanged |
| Saved layout containing a `plan:<id>` tab whose Job is gone | the tab is dropped on load |

## 13. Decisions (Claude's calls, 2026-10-18; the owner said to decide these, not ask)
1. **Settings is a tab, not a modal.** It can sit beside a terminal, and the box can deep-link into it.
2. **The Inbox stays a sidebar view.** Answering inline never hides the wall or the board. A desktop notice opens it.
3. **The dark themes are Umbra (default), Vega and Aurora, plus Light and System.** They cover near-black, graphite
   and green-grey, and each one is already a user-picked palette today.
4. **The owner hold releases after 60 s with no owner input.** That is long enough to read a reply and type the next
   line, and short enough that the coordinator is never held up for long. W9-H makes it a constant in `ownerHold.ts`,
   not a setting.
5. **The before-screenshots are taken when 9.1 starts** (W9-A step 0), when the app can run alone.
6. **Approval gate:** the mockup is the reference. The owner can comment on it at any time before 9.1 starts. If they
   say nothing, it counts as approved, so Wave 9 never waits on the owner.
