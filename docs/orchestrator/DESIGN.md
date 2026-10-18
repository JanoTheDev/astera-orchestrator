# Wave 9 design spec

Mockup (clickable, all four themes): https://claude.ai/artifact/DhSiAPZxCigXD4xJBoFb9x. It has two artboards:
- "Astera — clickable prototype": the shell, Home, a Plan tab, the Inbox, the search/command box, the New flow,
  Settings and the accounts popover. Its Tweaks switch the theme.
- "Themes, tokens and primitives".

Status: **draft, waiting for owner approval.** Once approved, every Wave 9 prompt builds against this file and the
mockup. Where they disagree, this file wins.

## 1. Layout

The window is 1440×900 in the mockup. The layout must hold down to 1024×640.

| Region | Size | Contents |
|---|---|---|
| Titlebar | 40px high | Left: the project switcher, showing the project's name and a "N waiting" chip; it opens the W6-F switcher menu. Centre: the search/command box button, 460px wide, which opens the box overlay. Right: the run config button, and one `Meter` for the active account's 5-hour usage, which opens the accounts popover. |
| Rail | 52px wide | Home, Inbox (badge = waiting count), Files, How It Works, then a spacer, then Settings. Icons are lucide at 20px, inside 40px buttons. The active button gets the `elevated` background. |
| Sidebar | 284px default, resizable 200–520px (`cm.sidebarWidth`) | Depends on the rail button; see §2. Pressing the active rail button collapses the sidebar (today's rule, `core/ui/sidebar.ts`). |
| Tab strip | 34px high | Every tab: plan, session, file, record, browser, app, media, settings. The active tab has a 2px accent line on top. Ended tabs follow the W7-F auto-close rule. The "All tabs" menu sits on the right. The W7-F quick switcher is unchanged. |
| Content | flex | The active tab. PaneGrid splitting works as today. |
| Bottom panel | resizable (`cm.runPanelHeight`) | Run output and terminals. Unchanged apart from tokens. |
| Status bar | 26px high | Running count · waiting count (opens the Inbox) · spacer · active account with its 5-hour and weekly usage (opens the accounts popover) · branch · host health (opens Settings › Advanced › Host when it is not ok). |

## 2. Rail views

**Home:**
- Header: the project name, and a "New" primary button that opens the New flow.
- Sections, each built on `Section` (collapsible, state kept in `cm.section.<id>`):
  - **Plans**: open by default. The tree is Project → Plan → Planner / Coordinator / Workers (W2-B, W6-F).
    - A plan row shows its progress (`5/9`) or its state (`approve`, `done`), plus a status dot.
    - A worker row shows its Task and its live state (`editing`, `asks`, `permission`, `review`).
    - Clicking a plan opens its Plan tab. Clicking a session opens its tab.
    - Archived plans sit in a "Done" sub-group, closed by default.
  - **Sessions**: tabs that belong to no plan.
  - **Worktrees**: the W1/W5 worktree panel, with its PR and push badges.
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

**How It Works:** the existing `UnderstandingView`, unchanged apart from tokens.

**Settings:**
- The sidebar holds a search field and the 7 groups. The content area is a **Settings tab**, not a modal, so it can
  sit beside a terminal and the box can deep-link into it (`openSettings(group, anchor)`).
- One Settings tab exists at most; opening Settings again focuses it.

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
| Notifications | Desktop notices, sound, digest (notifications) |
| Advanced | How It Works work unit and generator (hiw) · Worktree location (worktree) · History (history) · About, version, updates, host status (info) |

The settings search filters rows by label and description and shows the group each hit belongs to.

## 7. Feature map (one home per feature)

| Feature (wave) | New home |
|---|---|
| Sessions, PaneGrid, terminals (upstream) | Tabs in the content area · Home › Sessions |
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
| Delivery modes (W6-H) | Plan header chip · Settings › Projects |
| Projects create/add (W7-B) | Settings › Projects · switcher "Add project" |
| Tabs auto-close, switcher (W7-F) | Tab strip · "All tabs" menu |
| Attribution (W8) | Plan › Changes · blame gutter in file tabs · Settings › Projects row |
| Explorer, editor, markdown, media (upstream) | Rail › Files · file tabs |
| Run configs, bottom panel (upstream) | Titlebar run button · bottom panel |
| Worktrees panel, PR/push badges (upstream) | Home › Worktrees |
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
| theme `orion`, `antares`, `quasar`, `sirius` | `umbra` |
| `cm.sidebarWidth`, `cm.runPanelHeight`, key overrides | unchanged |
| Saved layout containing a `plan:<id>` tab whose Job is gone | the tab is dropped on load |

## 13. Open questions for the owner (answer on the mockup or here)
1. Is Settings as a tab right, rather than a modal? (Claude's call: a tab, so it can sit beside a terminal and be
   deep-linked.)
2. Should the Inbox stay a sidebar view (284px, answers inline), or open as a full tab? (Claude's call: the sidebar,
   so answering never hides the board.)
3. Are the three dark themes right (umbra, vega, aurora)?
4. Should the "before" screenshots from W9-0 step 1 be taken when Wave 9 starts? They were skipped now, because W7
   tabs are running and the app must run alone.
