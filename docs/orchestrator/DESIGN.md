# Wave 9 design spec

Mockup (clickable): https://claude.ai/artifact/DhSiAPZxCigXD4xJBoFb9x.
- **"Astera — clickable prototype"** opens on the Agents page. The top bar switches pages. Clicking a console opens
  it full size. Tasks, Plans (then click Auth rework), Inbox, Worktrees and Settings are all live. Its Tweaks switch
  the theme.
- **"Themes, tokens and primitives"** shows Night, Dusk and Day.

Status: **decided** (2026-10-18, §14). Silence before 9.1 = approved. Every Wave 9 prompt builds against this file and
the mockup. Where they disagree, this file wins.

## 0. What the owner asked for (2026-10-18)
- **Hands-off.** Astera runs plans by itself. The owner watches, steps in when needed, and reads afterwards what
  happened.
- **See every CLI console at once, and work in any of them without interrupting the coordinator.** This is the most
  important view.
- **A summary per console** when it finishes.
- **Separate, clean pages**, including a Tasks board. Nothing is crammed into one place.
- **Consoles look and behave exactly like the console.** The real Claude Code / Codex TUI, no custom chat UI. Slash
  commands, permission prompts and plan mode all work, because it *is* the CLI.
- **A new product look.** If released, it must not look like upstream Astera.

Rules every screen follows:
- **The app opens on the Agents page**, or on **Start** when the project has nothing yet.
- **Nothing pops up by itself.** No modal opens unless the owner clicks. Only Inbox items notify, with a sound.
  Auto-answers, merges, replans and clean-ups land in "Handled for you", silently.
- **The owner never has to type into the coordinator.** They answer in the Inbox, or in the worker's own console.
- **Ended consoles close on their own** (W7-F) and leave a summary card (§4).
- **Defaults lean automatic:** auto-approve per project is offered on a project's first plan; review and
  replan-between-waves are on; worktrees of merged Tasks are cleaned up after delivery.

## 1. Shell

The window is 1440×900 in the mockup. The layout must hold down to 1024×640, where the page tabs collapse into a
"Pages ▾" menu.

**There is no icon rail and no persistent sidebar.** Upstream's IDE shell (rail, stacked sidebar panels, pane grid as
home) goes away. Every page owns the full width below the top bar.

| Region | Size | Contents |
|---|---|---|
| Top bar | 44px, one line | From left: the brand mark and "Astera" `/` the project switcher (a plain text button with ⇅, W6-F menu); page tabs **Agents · Tasks · Plans · Inbox (count) · Worktrees · Files · More ▾** as plain text with a 2px `--accent` underline on the active one; a spacer; the search field (`⌃⇧K`, §6); **New** (the only filled button); a divider; the usage `Meter` (opens the accounts popover); Settings ⚙ as an icon button. |
| Page | flex | One page at a time (§2). The page remembers its own scroll and selection. |
| Status bar | 26px | Consoles count and working count (→ Agents) · waiting count (→ Inbox) · the next queued plan ("Next: X starts after Y delivers") · spacer · active account with 5-hour and weekly usage · host health. |

- **More ▾** holds History, How It Works, Browser and Run configs: upstream features that stay but are rarely
  needed.
- The run-config output and bottom terminal panel open as a drawer from the run-config page or the box, not as
  a permanent panel.
- **Keys:**
  - `Ctrl+1…6` switch pages (rebindable).
  - `Ctrl+Alt+1…9` switch projects, as today.
  - `Ctrl+Shift+K` opens the box.
  - `Ctrl+N` opens New.
  - `Ctrl+Shift+N` opens a new window (§1a).

## 1a. Windows (W9-K)
- Each project can have its own window, so two or three projects can run side by side.
- They are all windows of **one app process and one Host**. Accounts, usage, rolling and the app-wide worker cap stay
  single, and nothing is counted twice.
- Open a new window from the switcher's "Open in new window", `Ctrl+Shift+N`, the tray, or by launching again with
  `--project <name>`.
- A window shows only its project. Its title is "<project> — Astera".
- Notices open their project's window.
- The windows open at quit come back on launch. Closing the last window keeps plans running (W1-D).

## 2. Pages

### Agents (default; W9-H)
- **Console strip** across the top: "All consoles", then one entry per live console (Coordinator, Worker 2 · T4,
  Reviewer, Planner, plain consoles). A dot shows each console's state.
- **Plan filter** (the wall's toolbar): pills for **All plans**, then one per active or queued plan, then **No
  plan** (plain consoles). A plan pill shows the name, a 40px stacked progress bar and a short count ("4/9 · 2 need
  you", or "approve"). Hovering shows the full counts.
  - Picking a plan filters the tiles **and** the console strip.
  - With many plans, the pills become a searchable dropdown grouped by area.
  - The filter is remembered per window. "Its consoles" on a plan page opens Agents filtered to that plan.
- **The main console:** each plan has its own coordinator.
  - Filtered to one plan, that plan's coordinator is the first tile: twice as tall, labelled "main", with an accent
    border. Its strip entry reads "Coordinator (main)".
  - On All plans, every plan's coordinator is pinned first, in plan order.
- **All consoles (the wall):**
  - Scope: this plan / <project> / all projects.
  - Filter: All / Needs you / Working / Finished.
  - An auto grid of tiles: 1–4 consoles → 2 columns, 5–9 → 3, 10+ → 4. Needs-you tiles come first, with a warn
    or danger border.
  - Each tile has a header (name, Task, state chip) and a detail line, then **the console itself**: the session's
    own xterm at 10.5–11px, showing its real bottom lines, input box and mode line.
    - The detail line for a worker: wave, time running, files and commits.
    - For the coordinator: answered and escalated counts.
    - For the reviewer: round N of M.
  - Clicking a tile opens that console full size.
- **Below the tiles:** "Finished · what each console did", the summary cards (§4).
- **One console full size** (from a tile, the strip, a Task card, an Inbox card, the box):
  - A slim header: project › plan › name · Task, model, cwd, and "Back to all".
  - **Left: nothing but the console.** The full xterm, the CLI's own input box, its own mode line, its own
    permission prompts.
  - **Right: a details panel** (330px, collapsible, `Ctrl+.`).
    - **Worker:** the Task title and brief, running time, model and account, worktree, changes, and questions. Then
      "Done when", the acceptance criteria ticked as the reviewer or checks confirm them. Then **all Tasks of the
      plan**, with a state dot and who is on each (merged / Worker 2 · permission / Reviewer / wave 3). Clicking one
      jumps to its console or to the plan's Waves.
    - **Coordinator:** plan progress, wave, answered and escalated counts, then all Tasks and what each one is
      doing.
    - **Planner:** the planned Tasks.
    - **Reviewer:** the round and the criteria being checked.
    - All of this comes from data the Host already has (`JobTask`, `taskBoardsOf`, `lastAction`, review rounds,
      `acceptanceCriteria`), with no new agent calls.
  - **Typing goes straight into the PTY.** There is no Astera input box or chat UI.
- **The owner hold:**
  - A console the owner is looking at full size, or has typed into in the last 60 s, is held. While it is held, an
    agent's `sessions-send` into it is queued in the Host, not typed, so a coordinator message never lands in the
    middle of the owner's line.
  - The sender gets `{ queued: true, reason: 'owner-typing', target }` at once, so the coordinator never blocks.
    Queued messages are delivered in order on "Back to all" or after 60 s idle.
  - The header says: "You have the keyboard here · the coordinator's messages to this console wait until you
    leave". Nothing else pauses.
- **Tiles render the real terminals.** Offscreen tiles pause rendering. If 12 live tiles cost more than 15% of one
  core while idle on the owner's laptop, unfocused tiles fall back to a text tail of the same lines, and only the
  full-size console keeps a live xterm. W9-H measures this.
- The assistant-ui conversation pane (`conversation/*`) is **no longer offered for new consoles**. Existing
  conversation sessions still open, and can be removed later.

### Start (empty project, or New → a plan; W9-E)
- **Where the first plan goes.** A project with no plans and no consoles opens on Start instead of an empty
  wall. New → "Plan it for me" or "Run as written", and Plans → "New plan", open the same page.
- **Header:** "What should we build in <project>?" and one line saying what happens next.
- **One composer:**
  - A large text box (describe a goal, or paste a whole plan).
  - Attached files as chips: `.md`, `.pdf`, `.txt` and images. **Dropping files anywhere on the window opens Start
    with them attached.**
  - Under the box: + Attach files · GitHub issues (W6-A picker) · Audit the repo (W6-A `--mode audit`).
- **Two modes**, as two selectable cards:
  - **Plan it for me** (default for typed text or rough notes). The planner (opus) reads the code, `existing.md`
    and the issues, and writes the detailed plan: tasks, prompts, acceptance criteria, files, waves and models
    (W2-A, W6-A). The plan lands in the Inbox to approve or talk to (W7-A), or runs at once with auto-approve.
  - **Run as written** (default when prompt files are attached). Each attached `.md` file, or each `##` section of
    a single document, becomes **one task with its text kept exactly** (W8-C `--mode prompts`). Only files, deps,
    waves and models are filled in. `validatePlan` still checks it (missing files, same-file clashes, cycles).
    Approval defaults to auto, because the owner wrote it; consoles start right away.
- **Options row:** Consoles at once · Delivery · Start (right away / after <plan>) · Approval (ask me / auto). The
  defaults come from the project's settings (W7-B).
- **The primary button says what will happen:** "Start planning", or "Start 3 consoles" with "3 files → 3 tasks".
- **"Or pick up":** GitHub issues assigned to you, unfixed audit findings, and "Just open a console".
- After Start, the app goes to Agents. There, the planner's console, or the new task consoles, appear as tiles.

### Tasks (W9-C)
- A board of **every Task in the project, across plans**, in five columns: Planned · Working · Needs you · In
  review · Done.
- Plan filter pills (All plans / each plan).
- Cards show: id, title, live line (W6-E `lastAction`, or why it waits: `taskBoardsOf`), plan chip, worker and
  model. A card that needs you has the warn or danger border.
- Clicking a card goes to the right place:
  - working or in review → its console;
  - needs you → its Inbox card;
  - planned → its plan's Waves;
  - done → its summary.
- Done keeps the last 20 per plan; older ones are under the plan's page.

### Plans (W9-C)
- **Two views**, "By area" and "Overlap":
  - **By area** (default): plans grouped under their areas (W8-D `Job.areas`, such as Auth or Leaderboard), each
    group headed by its folders. A row whose plan overlaps another shows an "overlaps <plan>" chip.
  - **Overlap**: a table of plans × top folders. Each cell says what the plan does there ("editing", "T6 editing",
    "planned", "done"). A folder two plans both touch is highlighted, so it is clear at a glance who works where.
    Two plans never edit the same files at once: the later Task waits (W8-D guard).
- **List row:** one row per plan, showing:
  - state dot, title and state chip;
  - source and wave line;
  - progress bar (done/total);
  - delivery;
  - age.
- Order: running, awaiting approval, queued (with "starts after X delivers", W8-C), then delivered and archived
  (collapsed). "New plan" opens New at Plan from a source.
- **Plan page** (click a row; breadcrumb "Plans › <name>"):
  - **Header:** title (rename inline), state chips, and the actions Its consoles (→ Agents scoped to this plan),
    Pause/Resume, Talk to planner, ⋯ (priority, workers at once, start after, hold, archive, kill consoles, open PR).
  - Sections, segmented (the last one used is remembered per plan):
    - **Overview**:
      - objective, source and existing.md;
      - **What happened so far**, rolled up from the console summaries;
      - Talk to the planner (W7-A);
      - the approve bar while awaiting approval;
      - How it runs (models, workers, review, final check, delivery, usage);
      - the final check result and gates.
    - **Waves**:
      - one column per wave with state and count; the current wave marked; "Replanning wave N…".
      - Cards as on Tasks, plus their files; clicking a card follows the Tasks rules.
      - A toggle shows the dependency graph.
    - **Files**: the W6-E files table, with "Shared · one at a time".
    - **Changes**: PR bar (number, state, checks, AI/human share from W8), then files with +/−, Task, model and AI
      share. A file opens `DiffView` with the W8-B gutter.
    - **Journal**: `RunDetailJournal`, in mono.
- `RunDetail.tsx` and its modal are deleted. W9-C's PR lists every control's new home.

### Inbox (W9-D)
- Two columns:
  - **Needs you** (left, wide), oldest first:
    - Question: quick answers when the asker offered options, a text field and Send, plus "Open its console".
    - Plan approval: Review plan · Talk to planner · Approve. When the plan overlaps another (W8-D `Job.overlaps`),
      the card shows a warn box naming the Tasks and files ("L4 and Auth rework's T6 both edit
      src/api/routes.ts"), with **Start after <plan>** and **Move <task> into <plan>**. Approve then reads
      "Approve (L4 waits)".
    - Permission wait: "Answer in its console" (permission prompts stay in the real CLI, CONTEXT rule 6).
    - Give-up or escalation: Open plan · Retry · Skip.
  - **Handled for you** (right): the activity feed. It covers auto-answers, merges, replans, clean-ups, deliveries
    and usage pauses.
- Desktop notices, the chime, the nav badge and the status-bar count all call `openInbox()`.

### Worktrees (W9-J)
- **Left list:** grouped by running plan, "Ready to clean up", and "Yours". Each row shows the branch,
  ahead/behind, its console and dirty state. "Clean up N" sits on top.
- **Right detail:**
  - Header: the branch, state, base and ahead/behind, with the actions Its console · Open console here · Open in
    Files · ⋯ (push, create PR, remove, copy path).
  - Fact cards.
  - Changes vs base, which open `DiffView`.
  - Commits, each with its W8 author.
- After a plan is delivered, its ready worktrees are removed automatically. "Yours" never is. Every removal keeps
  the existing safety checks.

### Files
- The existing explorer and editor, full width: tree on the left, editor tabs on the right. Restyled only.

### Settings
- Groups on the left, with search; the group's rows on the right (§7). It is a page, not a modal.

## 4. Console summaries

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
  - The Agents page's Finished row.
  - The Task's card on the Tasks page and the plan's Waves.
  - The session's History row.
  - The plan's end: all of a plan's summaries roll up into the plan summary in Overview, and into the delivery PR
    body (W6-H) under "What each task did".
- **Storage:** next to the session record in the Host's store, as
  `SessionSummary { sessionId, jobId?, taskId?, at, outcome, durationMs, facts, text, model }`.
  - Only ids and facts are stored. There is no prompt text beyond what the session store already keeps.
  - Nothing goes into git except the PR-body roll-up, which is part of a delivery the owner set up.

## 5. New
- A small `Modal`, from **New**, `Ctrl+N` or the box. It offers three choices:
  - **Console**: a plain Claude Code or Codex console (agent, account, folder, worktree).
  - **Plan it for me** → the Start page in that mode.
  - **Run as written** → the Start page in that mode.
- Plans are always created on the Start page (§2), so there is one place to drop a plan.

## 6. Search and command box
- One overlay from the top bar pill or `Ctrl+Shift+K`.
- Results are grouped as Consoles, Tasks, Plans, Settings and Commands, and it matches initials too (W3-C, W3-B).
  Destructive intents still confirm in the UI.
- Holding `Ctrl+Shift+M` starts push-to-talk.

## 7. Settings groups (every current setting → its group)

| Group | Settings (current tab in brackets) |
|---|---|
| General | Language, default session kind (general) · Theme, density, console font (appearance) · Shortcuts (shortcuts) |
| Accounts & usage | Accounts, sign in, remove, rolling (accounts) · Usage guard, subagents per tab (agent) |
| Agents | Role models (agent › OrchestratorModels) · Permission mode, max workers, resume strategy (agent) · Voice (agent) · Agent browser, agent app (agent) |
| Projects | One page per project (W7-B): delivery, auto-approve, test command, concurrency, review rounds, replan, account, line attribution (W8-B) · Add project |
| Integrations | GitHub (github) · Slack (slack) · CLI, MCP (cli) · Remote runtimes (remote) · Plugins (plugins) · Creative hub (creativeHub) |
| Notifications | Desktop notices, sound, digest (notifications) · Console summaries on/off, summary model (new, W9-I) |
| Advanced | How It Works work unit and generator (hiw) · Worktree location (worktree) · History (history) · About, version, updates, host status (info) |

The settings search filters rows by label and description and shows the group each hit belongs to.

## 8. Feature map (one home per feature)

| Feature (wave) | New home |
|---|---|
| Every console at once; step in without disturbing the coordinator (W9-H) | **Agents** page: wall, full-size console, owner hold |
| What each console did (W9-I) | Summaries: Agents › Finished · Task cards · Plan › Overview · PR body · History |
| Sessions, terminals, PaneGrid (upstream) | Agents page (the PaneGrid split view survives inside a full-size console: "Split" in its header) |
| Task board, why waiting (W2-C, W6-E) | **Tasks** page · Plan › Waves |
| Plans, lifecycle, priority, holds (W1-B, W1-C, W5-C) | **Plans** page and plan page header/⋯ |
| Planner stage, approve, talk (W2-A, W7-A) | Inbox approval · Plan › Overview |
| Workspace tree (W2-B, W6-F) | Replaced by pages and the project switcher; the console strip lists consoles |
| GitHub links, PR (W2-D) | Plan › Changes · Task cards |
| Activity feed, digest (W3-A) | Inbox › Handled for you · Settings › Notifications |
| Command bar, voice, search (W3-B, W3-C) | The box |
| Needs-input inbox, escalations, answers (W3-C, W6-B, W7-C) | **Inbox** page |
| Intake, sources, assign-me (W6-A, W7-D) | **Start** page: composer, attach, GitHub issues, audit |
| Prompt files, start after, heavy-job slot (W8-C) | Start › Run as written / Start after · Plans list "Queued" · Task live line "Waiting for the heavy-job slot" |
| Same-file rule (W6-C), across plans (W8-D) | Plan › Files · Task live line "Waits for <plan> · <task>" · Plans › Overlap |
| Plan areas, overlaps (W8-D) | Plans › By area / Overlap · Inbox approval card · Agents plan filter |
| Replanning (W6-D) | Plan › Waves header · Journal |
| Projects, per-project settings (W6-F, W7-B) | Project switcher · Settings › Projects |
| Several projects at once (W9-K) | A window per project |
| Delivery modes (W6-H) | Plan header chip · Settings › Projects |
| Accounts, rolling, usage (upstream, W6-G, W7-F) | Top-bar `Meter` → accounts popover · Settings › Accounts & usage |
| Role models, caps (W1-A, W1-B) | Settings › Agents · Plan › Overview |
| Tabs auto-close, switcher (W7-F) | Console strip (ended consoles close; summary stays) · the box |
| Attribution (W8) | Plan › Changes · Worktrees commits · blame gutter in Files |
| Worktrees panel (upstream) | **Worktrees** page (W9-J) |
| Explorer, editor, media (upstream) | **Files** page |
| History, How It Works, Browser, Run configs (upstream) | More ▾ |
| Remote runtimes, Plugins, MCP, CLI, Slack, Creative hub (upstream) | Settings › Integrations |
| Updates, host health (upstream, W0) | Status bar · Settings › Advanced |
| Linux background, tray (W1-D) | Unchanged |

## 9. Identity and tokens (new product look)

**Upstream's look is dropped entirely.** Its 7 theme palettes, Geist, the icon rail and the IDE sidebar all go.

| Token | night (default) | dusk | day |
|---|---|---|---|
| `--bg` | #0d0e12 | #141219 | #f7f7f2 |
| `--panel` | #15171d | #1b1922 | #ffffff |
| `--elevated` | #232631 | #2a2734 | #ebebe3 |
| `--hover` | #1c1f28 | #221f2b | #f0f0ea |
| `--term-bg` | #090a0d | #0f0d13 | #ffffff |
| `--line` | #262a35 | #2e2a38 | #e0e0d6 |
| `--text` / `--text-dim` / `--text-faint` | #eef0f5 / #a3a8b8 / #7d8396 | #f0edf6 / #aba5b9 / #868097 | #16181d / #535866 / #6b7080 |
| `--accent` / `--accent-ink` / `--accent-soft` | #c4f25a / #121a00 / #252e10 (lime) | #b79cff / #1a0f33 / #2a2240 (lavender) | #3f6212 / #ffffff / #e7f0d6 (olive) |
| `--ok` / `--ok-soft` | #5ad19a / #10291e | #5ad19a / #14291f | #15803d / #dcf2e3 |
| `--warn` / `--warn-soft` | #f2b84b / #30240c | #f2b84b / #30240c | #8a5a00 / #fbefd5 |
| `--danger` / `--danger-soft` | #ff6b6b / #351719 | #ff6b6b / #351719 | #c42b2b / #fbe3e3 |

- **Type:** IBM Plex Sans for the UI and JetBrains Mono for consoles and code. Both are OFL-licensed and **bundled as
  woff2 in the app**: no font is fetched at runtime (the mockup uses Google Fonts only to preview). Scale: 11 · 12 ·
  13 · 15 · 18.
- **Shape (quiet chrome, so the consoles get the space and the attention):**
  - Page tabs are text with an underline, never filled pills.
  - Buttons are flat (`--elevated` fill, no outline, radius 6). Only the primary action of a view is filled with
    `--accent`.
  - Icon-only controls are 30px ghost buttons.
  - Cards have radius 10 and a 1px `--line` border.
- **Console colours** follow the CLI's own ANSI output. The xterm theme takes only the background, foreground,
  cursor and selection from the tokens (`--term-bg`, `--text`, `--accent`).
- **Mark:** a rounded square in `--accent` holding a pulse line, beside the word "Astera". It replaces upstream's
  logo and banner.
- **Other tokens:**
  - PR colours, `--agent-accent`, git and file-icon colours stay outside the themes.
  - Spacing in steps of 4. Rows 28–30.
  - Motion 120–180ms, and none under reduced-motion.
- **Contrast:** `contrast.test.ts` covers every theme.
  - dim on `--elevated` ≥ 4.5;
  - faint ≥ 3;
  - ink on accent ≥ 4.5;
  - chip text on its soft background ≥ 4.5.
  - W9-A adjusts any value that fails and lists it.
- **Theme ids:** `night` (default), `dusk`, `day`, and `system` (light → `day`, dark → `night`). Every old id maps
  to `night`, except `light`, which maps to `day`.

## 10. Primitives (`components/ui/`)

| Primitive | Variants | States / behaviour |
|---|---|---|
| `Button` | primary, secondary (default), ghost, danger · sm 24 / md 28 | hover, focus ring, disabled, loading (spinner replaces the icon) |
| `Chip` | neutral, info, ok, warn, danger · optional dot | none |
| `Card` | plain, focus (accent border), need (warn border), danger | clickable cards are `<button>` |
| `Modal` | sm 440 / md 640 / lg 880 | backdrop, focus trap, Esc closes, `backdropProps` drag-safe close, returns focus |
| `Section` | none | collapsible header with chevron, label, count and action slot · persisted `cm.section.<id>` |
| `Nav` | top-bar text tabs with underline, optional count | `aria-current="page"`, arrow keys |
| `Tabs` | strip (console strip), segmented (plan sections) | arrow-key navigation, `role="tablist"` |
| `Menu` | none | keyboard navigation, the "⋯" row menus, the project switcher, "All tabs" |
| `Field` | text, textarea, select, number, toggle | label, hint, error |
| `Meter` | none | thresholds: under 75 accent, 75–89 warn, 90+ danger (usage guard) · optional label |
| `EmptyState` | none | icon, one line, optional action |
| `Icon` | lucide names only | 14 / 16 / 20 |

The hand-drawn glyphs (`JobIcons`, `FolderGlyph`, `BranchGlyph`, `ResumeGlyph`, `UnderstandingIcons`, and the rail
SVGs in `App.tsx`, which go away with the rail) become lucide icons. `FileIcon` stays, because it uses file-type colours.

## 11. Dialogs → replacements

| Dialog | Becomes |
|---|---|
| `NewSessionDialog`, `NewRunModal`/`NewPlanDialog`, `SourceJobModal` | New (§5) |
| `RunDetail` | The plan page (§2) |
| Settings modal (inline in `App.tsx`) | The Settings page |
| Pane grid as the landing view, workspace sidebar | The Agents page |
| `NewTaskModal`, `CreatePrDialog`, `ResumeDialog`, `LocalHistoryDialog`, `RemoteSessionsDialog`, `RunConfigManager`, `BypassRetryDialog`, `FirstRunDialog`, `ConfirmHost`, account add/import, `HiggsfieldSettings` dialog, `HistoryBrowser` dialog, `BrowserPane` dialog | `ui/Modal`, same content |
| `CommandBar` | The box (§6) |

## 12. Pinned tests (keep the invariant, move the path)

| Test | Invariant | Moved by |
|---|---|---|
| `App.layoutWriteThrough.test.ts` | `setLayout`/`setActivePaneId`/`setSessions` are `writeThrough` memos, and refs are never assigned by hand | W9-A (follows the layout state hook) |
| `App.spawnUnattended.test.ts` | `spawn()` forwards the unattended policy | W9-A |
| `lib/folderLink.wiring.test.ts` | folder links are wired in App, BottomPanel, ConversationPane, FileExplorer, PaneGrid, RunPanel, TerminalBody, TerminalView | W9-A |
| `lib/openPath.test.ts`, `updateInstallPaths.test.ts`, `core/files/icons.test.ts` | they read `App.tsx` / `styles.css` text | W9-A |
| `JobsView.title.test.ts`, `SourceChip.test.ts`, `jobActions.holds.test.ts` | they read `RunDetail.tsx` | W9-C (repoint to `PlanPage`) |
| `FileExplorer.refresh.test.ts` | it reads FileExplorer and `styles.css` | W9-A |
| `core/orchestration/completionCss.test.ts` | `.detail-completion-*` max-height 160, overflow auto | W9-A (path), W9-C (selector) |
| `spinnerCss.test.ts` | `.job-arc`, `cm-spin` keep spinning under reduced motion | W9-A |
| `core/terminal/scrollbarCss.test.ts`, `shrinkCss.test.ts` | `.terminal-host` rules | W9-A |
| `core/theme/contrast.test.ts` | contrast ratios | W9-A (extended to every theme) |
| `styles.hiw.test.ts` | no colour literals in `.hiw-*`, and so on | W9-A (generalised to all renderer CSS) |

## 13. Migration (saved state keeps working)

| Saved | New |
|---|---|
| `sidebarPane` (any) | page `agents` (`explorer` → `files`) |
| Workspace/sidebar section state, `cm.sidebarWidth` | dropped |
| theme `umbra`, `vega`, `aurora`, `orion`, `antares`, `quasar`, `sirius` | `night` · `light` → `day` |
| `cm.runPanelHeight`, key overrides | kept (the drawer uses the height) |
| Saved pane layouts | kept for full-size console splits; tabs whose session or Job is gone are dropped on load |

## 14. Decisions (Claude's calls, 2026-10-18; the owner said to decide, not ask)
1. **Pages, not panels.** A top bar with page pills replaces the rail and sidebar (owner: "different pages, we don't
   need to fit everything in the same place"). It is also the clearest break from upstream's IDE look.
2. **Consoles are the real CLI**, never a custom chat. There is no "send a line" box: answers go through the Inbox,
   or by typing in the console.
3. **The Inbox is a page with two columns.** The answer has room, and "Handled for you" shows what was automated.
4. **Themes:** Night (default), Dusk and Day, plus System. These are new palettes, not upstream's.
5. **Fonts:** IBM Plex Sans and JetBrains Mono, bundled locally.
6. **The owner hold** releases on "Back to all" or after 60 s idle. It is a constant, not a setting.
7. **The name stays "Astera"** (owner, 2026-10-18). Upstream is also called Astera, so the name is now the main
   thing the two products share. A rename only touches the wordmark, `productName` and the README, so it can
   happen at any time.
8. **The before-screenshots** are taken when 9.1 starts (W9-A step 0).
9. **Approval:** the mockup is the reference. Silence before 9.1 counts as approved.
