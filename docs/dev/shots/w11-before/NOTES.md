# W11 before: what is wrong, per shot

Taken with `npm run shots` (see `docs/dev/CONTEXT.md`) from the dev profile: no open project, no plan, one account.
File names are `<size>-<theme>-<NN>-<page>.png`; the notes apply to Night and Day at both sizes unless a size or theme is named.
**Not shot:** `02-start` and `05-plan`. The Start page needs an open project and the Plan page needs a plan; this profile has neither
(the Plans page says "No project is open"), so the script skipped them. Shoot them from a profile with a project before the Start/Plan redesign.

Problems on every page (the shell)
- Top bar is crowded and flat: the project switcher "two ⇅" has no label saying it is the project, "Agents/Tasks/…" tabs and "More" sit at the same weight as the search box; the title-bar window buttons and the app menu are one unseparated strip.
- Usage meter in the top bar shows "jip.claude… 16%" truncated, with no hint of what 16% is (5h window) until hover; the same data is repeated in the status bar.
- Status bar is dense mono text: "0 consoles · 0 working", "0 waiting for you", two usage bars, "Host ok". Nothing is grouped or prioritised; "Host ok" is cryptic.
- Empty states are bare grey sentences with no illustration or primary action; most pages are 80% empty black or cream.

01-agents (1440 and 1024)
- Two stacked rows of filter chips ("All plans / No plan" and "No project / All projects" + "All / Needs you / Working / Finished") with three different chip styles (outlined pill, segmented, segmented): the same kind of control looks three ways.
- "All consoles" tab sits under the top bar with an underline style unlike the top bar's own active underline; its purpose is unclear.
- Empty state "No consoles here yet. New opens one." is tiny and centred far from the filters; it names "New" but the New button is not near it.
- At 1024 the page tabs fold into a single "Agents ⌄" menu, so the person loses the one-click page switch; the folded label is low contrast in Day.

03-tasks
- Five kanban columns with only a heading and "No Tasks here yet." each; zero-count badges and five identical empty messages say the same thing five times.
- The only control is an "All plans" chip; no way to create a task or plan from here.
- Column headings are small and tight to the page title; no column backgrounds or dividers, so columns are not visible as columns at all when empty.
- 1024: columns shrink to ~200px; headings are fine but the layout will break once cards exist (no horizontal scroll or wrap seen).

04-plans
- Page content is a narrow block pushed to the left third (title "Plans", "By area / Overlap" toggle) while the empty message is centred in the window: two alignment axes.
- "No project is open / Open a session and its folder becomes this window project — jobs can be created here from then on" is a very small grey wall of text with an em-dash; it explains a prerequisite instead of offering the action (New / open folder).
- "By area / Overlap" toggle has no explanation of what the two views are.

06-inbox
- Left column "NEEDS YOU 0" is empty (check icon + "Nothing needs you right now") while the right column "HANDLED FOR YOU" is a long unbroken log: the empty half wastes half the page and the log half has no grouping by day, plan or task.
- Log rows repeat the same long task objective under every event ("In the existing index.js add two independent functions…") three lines each, so real events (cancelled, started, queued) are hard to scan; the event title is the only distinguishing part.
- Colour is the only status cue: orange for "cancelled" and for a needs-answer row, white for the rest, grey for older; no icons, and the faint grey rows are barely readable in Night.
- Timestamps are mono, grey, and show only "05:20 AM" with no date, so rows from different days mix.
- Filter tabs "All 0 / Approvals / Questions / Permissions / Handled" have a count on one tab only.
- 1024: the two columns squeeze; the log wraps to 5-6 lines per row and the empty left column still takes 40% of the width.

07-worktrees
- Left list is a long scroll of plan groups with 30-char truncated titles ("The source below is a list of problems. Plan one or m…"); two identical groups appear back to back (duplicates not distinguished).
- Each row shows branch name in mono bold plus a grey subtitle truncated mid-word, and "(Folder not reachable)" repeated on a dozen rows: a warning that is noise because it is everywhere and has no colour or action.
- A trash icon on every row, same weight as text, no confirm affordance visible; destructive action next to selectable text.
- Right pane is "Pick a worktree to see what is in it." with a lone "Close" link at top right (what does it close?). A 60% empty pane next to a dense list.
- Refresh icon next to the heading is the only toolbar; no search, filter, or "only reachable" toggle.

08-files
- Explorer shows "No active session" and a lone ✕ icon below the heading; the main area is an empty black canvas with only an "All consoles" tab and a floating "+ Start a new session" button at the bottom centre.
- The Files page is actually a session-bound explorer, so it is empty unless a session is open; the page name promises files.
- Bottom-centre bright-green button is far from everything else and the only saturated element on the page.

09-settings
- The top bar highlights "Files" while Settings is open (Settings has no tab; the previously open page stays marked), and at 1024 the folded menu reads "Files ⌄". Navigation location is wrong.
- General section is one long scrolling form: Language, New sessions start as, a checkbox with a 2-line explanation, Theme cards, two font dropdowns, then a keyboard-shortcut list, all as one page under "General".
- The shortcut list is a two-column table with the chord on the left and its name right-aligned at the far edge, 350px apart; the eye cannot connect them. Edit and reset icons repeat on every row.
- Control styles are inconsistent: dropdowns have different widths and right edges (System (English), Terminal, System default), the checkbox is a bright green outline, theme cards are a different style again.
- Content column is 880px wide, left-aligned, with a big empty right gutter at 1440; at 1024 it is cramped against the sidebar.
- Settings side nav ("General, Accounts & usage, Agents, Projects, Integrations, Notifications, Advanced") has a highlight but no icons; "Back" button and the Settings title sit in their own thin bar.

10-new-menu
- A modal with three large cards (Console, Plan it for me, Run as written); the three descriptions are of different lengths (Console wraps two lines) so cards are different heights.
- Cards show no keyboard hint though New is a keyboard action (Ctrl+N); the close ✕ gets a heavy focus ring on open that looks like a selected state.
- Wording is unclear: "Console" vs "Plan it for me" vs "Run as written" mix nouns and phrases; the person cannot tell which is the usual choice (no default or emphasis).
- Day: the scrim washes out the top bar and the page behind into near-invisible grey, and the dialog has a faint shadow only; the card borders are very light.

11-project-switcher
- The menu is a tall list with 10 workspace rows, then 10 "Open X in new window" rows, then 10 "X settings…" rows: 30 entries long, running off the bottom of the 900px window (cut at "dfparent settings…").
- Long names wrap and collide ("Open astera-dogfood-gh in new window" overlaps the next row's text).
- Each workspace row carries a dot, a count "0" and a "Ctrl+Alt+N" hint only for the first nine; counts of 0 on every row add noise.
- The current project "two" is only a green name with no check; "All tabs" at the top has no separator from the projects.
- Per-project actions belong to a row (hover/overflow), not three sections of the same menu.

12-accounts
- The usage button in the top bar opens a small popover titled "ACCOUNTS 1" with three unlabeled icon buttons (+, folder, refresh) with no tooltips visible; the row shows a blue dot, a ✱ glyph, the e-mail, a "default" tag, two tiny usage bars and a green dot, none explained.
- Two stacked tiny bars (5h and weekly) are 40px wide with no labels or percentages here, though the status bar shows both with labels; the popover has less information than the status bar.
- Popover is anchored under the meter but its right edge hangs past the "settings" gear; at 1024 it overlaps the New button.
- Day: the "default" tag and popover border are barely visible.

Day theme (all pages)
- Page background is a warm off-white (#f6f6f0-ish) while panels and chips are white or light grey; the separation between page, panel and chip is 3-4% luminance, so cards and filters nearly vanish.
- Primary accent is dark green for New/active tab but the focus ring is a lighter green outline of a different hue; the two greens do not match.
- Muted text (counts, timestamps, hints) is light grey on cream and fails contrast.
