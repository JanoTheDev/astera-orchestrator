# W11 before: what is wrong, per shot

Taken with `npm run shots` (see `docs/dev/CONTEXT.md`) from the dev profile: project "two" (a scratch repo, `/tmp/w9proj/two`) open with one idle console, one account, no live plan.
File names are `<size>-<theme>-<NN>-<page>.png`; the notes apply to Night and Day at both sizes unless a size or theme is named.
**Not shot:** `05-plan`, the Plan page: it needs a live plan and the profile has only archived ones ("Show archived (2)"). The script skips it when absent.

Problems on every page (the shell)
- Top bar is crowded and flat: the project switcher "two ⇅" has no label saying it is the project, "Agents/Tasks/…" tabs and "More" sit at the same weight as the search box; the title-bar window buttons and the app menu are one unseparated strip.
- Usage meter in the top bar shows "jip.claude… 16%" truncated, with no hint of what 16% is (5h window) until hover; the same data is repeated in the status bar.
- Status bar is dense mono text: "0 consoles · 0 working", "0 waiting for you", two usage bars, "Host ok". Nothing is grouped or prioritised; "Host ok" is cryptic.
- Empty states are bare grey sentences with no illustration or primary action; most pages are 80% empty black or cream.

01-agents (1440 and 1024)
- Two stacked rows of filter chips ("All plans / No plan" and "two / All projects" + "All / Needs you / Working / Finished") with three different chip styles (outlined pill, segmented, segmented): the same kind of control looks three ways.
- The one console is a 700px card in the top-left corner with a huge empty terminal body, a clipped status line ("Review Audit Board Details [-]" cut at the card edge, worse in Day where it reads "Rev:") and an "Idle" badge; the remaining 50% of the page is blank.
- "All consoles" tab and a green dot + "two" chip sit in a second bar under the top bar with an underline style unlike the top bar's active underline; what the bar is for is unclear.
- Card shows only the folder name "two" as title; no account, agent, plan or last-activity line, so cards will not be distinguishable with several consoles.
- 1024: the page tabs fold into one "Agents ⌄" menu, so the person loses the one-click page switch; the folded label is low contrast in Day.

02-start (1440 and 1024; opened with New → "Plan it for me")
- A full-page form ("What should we build in two?") with the top bar still showing "Agents" as the active page and the New button highlighted: it is neither a page nor a modal, and there is no way to tell where Back goes except the small ✕ at the far right of the heading.
- Hierarchy is flat: the goal textarea, three mode cards (Plan it for me / Audit / Run as written), a bare toggle "Hands-off", a native `<select>` "Start: Right away", "More options · 3 consoles · PR · ask · account" and the green "Start planning" button all have similar weight; the primary action is small and dull olive and sits below the fold at 1024 (the page needs scrolling to reach it).
- Native controls leak through: the "Start" dropdown is an unstyled OS select and the Hands-off switch has no visible label next to it (its label and explanation sit below the track, offset 350px left of the "Start" field).
- Mode cards have uneven heights and an empty third column; Audit has no icon-alignment match with the others; the selected card is marked only by a thin lime outline.
- "Or pick up / Just open a console" at the bottom is a second, unrelated entry point rendered as a small grey button; it reads as an afterthought.
- Day: the outlines of the textarea and cards are near-invisible against the cream page; the New button gets a double ring (focus + hover state) while Start is open.

03-tasks
- Five kanban columns with only a heading and "No Tasks here yet." each; zero-count badges and five identical empty messages say the same thing five times.
- The only control is an "All plans" chip; no way to create a task or plan from here.
- Column headings are small and tight to the page title; no column backgrounds or dividers, so columns are not visible as columns at all when empty.
- 1024: columns shrink to ~200px; headings are fine but the layout will break once cards exist (no horizontal scroll or wrap seen).

04-plans
- Content is a narrow block pushed to the left (title "Plans", "By area / Overlap" toggle) while "+ New job" and "+ From a source" float at the right edge of an 880px column, stacked at different widths and nowhere near the title: two alignment axes and an orphaned toolbar.
- "When a plan is done: [Open one pull request (never merged by Astera)]" is a native select with a long value; the setting is unrelated to browsing plans and sits above the (empty) list.
- "Show archived (2)" is tiny grey text under the select; the list itself is empty with no empty-state message or hint that "New job" is the next step.
- "By area / Overlap" toggle has no explanation of what the two views are.
- Without an open project (earlier baseline) the page said only "No project is open … jobs can be created here from then on" as a tiny grey sentence and offered no action.

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
- Left explorer is a thin tree (".git", "README.md") with a ✕ icon under the "TWO" heading that has no label; refresh icon beside it has none either.
- The main area is the console of the open session with its own inner tab bar ("two ✕ +", "Terminal" badge, ⌄) beneath the "All consoles / two" bar: three stacked tab strips (page tabs, workspace bar, session tabs) that all look different.
- The Files page opens no file; it is a console with an explorer docked, so the page name does not match what is shown. With no session open it is empty with only a floating "+ Start a new session" button.
- The terminal status line and Claude banner dominate; nothing marks which pane is the file viewer.

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
