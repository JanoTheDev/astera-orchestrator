# W12 before: what is wrong, per screen

Taken on the dev profile (`~/.config/astera-dev`) from `main` as it is now, 1440×900, Night and Day, with `npm run shots` plus CDP for the states the script does not reach. The dev profile's open project is "two" (not added by this Task). Files are `<screen>/1440x900-<night|day>-<name>.png`.
Read by eye this pass: the shots marked **read**. Unmarked shots exist but were not re-read here: their notes are not claimed. Night was read for most screens; Day only where marked.

## Not reached (gaps, not failures)
- **plan** (a live plan page): the profile has no live plan, only archived ones; starting one would run planner agents. Folder empty.
- **errors**: no error state reachable on the profile (Inbox shows none). Folder empty.
- **tools** (bottom panel, run tools): needs a console or a run; "New console" would start a real `claude` session on the owner's account, so it was not clicked. Folder empty.
- **context menu**: no file row or tab exists on the profile (the Files explorer fails to read, see below). Shot `overlays/…-context-menu.png` not written.
- **New task dialog** and **Create PR dialog**: no "New task" item in the New menu; Create PR needs a worktree with commits. Not written.
- **about** (Advanced info card): no Info or Advanced card found in Settings nav. `about/` holds General with the per-group "Show advanced settings" expanded, which is not the card.
- **history sidebar** (Ctrl+Shift+A) and **jobs sidebar** (Ctrl+Shift+J): the chords do not open a sidebar on this build (Ctrl+Shift+J landed on Plans). Not kept. History is shot as the More › History page.
- **Scratch repo**: not added. `astera projects add` refuses agent sessions (`ASTERA_SESSION`), and the guard was not bypassed. The Start page shot uses the existing project "two".
- **help**: skipped (no content yet, per the Task).
- **onboarding step 6** (done) and **step 2** (kept as `firstrun/`): not shot separately.

## shell (Agents frame, both themes)
- Top bar is crowded: "All projects" project switcher, five page tabs, search, bell, account, usage meter, New, gear and window buttons share one line.
- Search placeholder is clipped at the field edge ("Search or com…"); the Ctrl Shift K keycaps read as a second field.
- Usage meter reads "jip.claude3@gm…" truncated, then a bar and "17%" with no label of what 17% means (5h window) until hover.
- Status bar is grey micro text: "No consoles", "5h 17% · week 67%", "Connected". Nothing grouped or prioritised.
- Window buttons and the gear are icon-only.

## agents (Home, no console)
- Single centred empty state ("No consoles yet", one primary "New console"). Page header is the word "Agents" alone; nothing else on the page.

## start (New › Plan with me) — Day read
- "What do you want done?" is a full page with a Back arrow; the top bar still shows Home active, so it reads as neither page nor modal.
- Project is a native-looking select; mode is a segmented control ("Plan with me / Plan and start on its own / Run my prompts as written") with a one-line explanation below it.
- Quick topics ("Fix bugs", "Build a feature", "Audit a folder", "From GitHub issues", "From a file") sit as a second row of identical grey chips directly above the mode control.
- "More options" disclosure and "Open a console instead" link are small and grey; the primary "Start planning" sits at the bottom in a faint disabled tint until text is typed.

## plans — Night read
- "Plans 0 plans" header; "From a source" and "New job" (primary) at the right, a filter icon with no label.
- Segmented "By area / Overlap / Main plan" has no explanation of the views; "Show archived (2)" is a small outline chip.
- "Plans | All tasks" toggle sits centred above the header, a third alignment axis.
- Empty state "No plans yet" with a second "New job" button: two identical primaries on one page.

## tasks
- Not re-read this pass. See the W11 baseline for the five empty kanban columns.

## inbox — Night read
- "Needs you" is a thin strip ("Nothing needs you right now") and "Handled for you" below it: the split is now a stacked list, not two columns.
- Rows show a date header ("Oct 18") but row times have no date; icon (ring, warning triangle) is the only status cue besides text.
- The "Handled 2" count shows on one filter only; Approvals, Questions and Permissions have no count.

## worktrees — Night read
- Empty state "No worktrees yet" with a text "Refresh" button; a filter icon and a close × at the far right with no label for what × closes.

## files — Night read
- Explorer shows "Read failed: Error invoking remote method 'files.list'" clipped at the panel edge ("'files.list" cut off). The error is the only content.
- Explorer header icons (new file, new folder, refresh, collapse, ×) have no labels.
- The page is a console area with the "All consoles" tab and a floating "+ Start a new session" pill at bottom centre; no file viewer is visible, so the page name and content do not match.

## accounts (accounts popover) — Night read
- "ACCOUNTS 1" popover; the account name is clipped to one letter ("j") next to a dot and an asterisk.
- "5h" and "Weekly" bars with 17% and 67%: the bars are nearly empty and their labels stack in grey.
- "Use for this tab" is plain text, not a button; the +, folder and scan buttons are icon-only.

## settings
- settings/general (Night read): clean 720px column. "Show onboarding again" has a bare "Show" button; "Advanced mode" is a switch without a state word; "Show advanced settings" is a small centred link under the theme cards; the System theme card is a half-white split with no border cue.
- settings/integrations — Night read: "Turn on" sits right-aligned under the address dropdown, detached from the line "Remote Runtime is off"; "Add a machine" is a primary button competing with it; "None yet." is small grey.
- settings/projects — Night read: the form is a long single column. "Open one pull request…" and "Default (waves)" are native selects. "Workers at once" and "Review rounds" look disabled (grey) with no reason shown. "Who wrote this" uses dash icon buttons. The project list has no search.
- settings/accounts-usage, settings/notifications, settings-page shots: not re-read this pass.

## onboarding and firstrun
- onboarding/1-welcome (Night read): progress is six tiny dots and "Step 1 of 6"; Language is a select; "Skip setup" is a text link, "Get started" a primary.
- firstrun/2-tools (Night read): Claude CLI shows "2.1.301 (Claude Code)" with a "Reinstall" button; Codex shows "Not detected" with an "Install" button in the same grey style; the green check line "Ready. You can add the other one later…" sits between the list and the nav row; Back / Skip setup / Next split across the bottom.
- onboarding/3-accounts, 4-project, 5-preferences: not re-read this pass.

## history — Night read
- "HISTORY" page: a list of project names with mono timestamps on the right and chevrons; "All accounts" select with a refresh icon. No search, and the header does not say what a row expands to.

## overlays
- bell-popover (Night read): "Notifications" with "All projects" and "Mark all read"; "Recent" rows are truncated mid-word ("…unde…", "…at 19%…"); times are grey micro text.
- command-bar (Night read): placeholder is clipped by the mic icon ("(e.g. "what are workers w…"); the × is the only close affordance.
- quick-switcher: Night and Day shots exist; not re-read this pass.
- new-menu (Night read): modal "New" with three cards (icon, title, two-line description, chevron) and "Open a console instead" as a grey link. Readable; the link is the weakest item.
- how-it-works (Night read): a 300px sidebar with one error item: red "!" mark, bold objective, orange error line truncated ("…pick one in Settin…"), tiny "Write it up again" button. The main pane is empty with a floating "+ Start a new session" pill at bottom centre. The top-bar tab reads "How It Works ⌄".
- project-switcher (scripted), more-menu: not re-read this pass.

## Files per screen
- **shell**: `1440x900-day-shell.png` `1440x900-night-shell.png` 
- **agents**: `1440x900-day-agents.png` `1440x900-night-agents.png` 
- **start**: `1440x900-day-plan-with-me.png` `1440x900-night-plan-with-me.png` 
- **plan**: none (see gaps)
- **plans**: `1440x900-day-plans.png` `1440x900-night-plans.png` 
- **tasks**: `1440x900-day-tasks.png` `1440x900-night-tasks.png` 
- **files**: `1440x900-day-files.png` `1440x900-night-files.png` 
- **worktrees**: `1440x900-day-worktrees.png` `1440x900-night-worktrees.png` 
- **accounts**: `1440x900-day-accounts.png` `1440x900-day-popover.png` `1440x900-night-accounts.png` `1440x900-night-popover.png` 
- **settings**: `1440x900-day-accounts-usage.png` `1440x900-day-general.png` `1440x900-day-integrations.png` `1440x900-day-notifications.png` `1440x900-day-projects.png` `1440x900-day-settings-page.png` `1440x900-night-accounts-usage.png` `1440x900-night-general.png` `1440x900-night-integrations.png` `1440x900-night-notifications.png` `1440x900-night-projects.png` `1440x900-night-settings-page.png` 
- **integrations**: `1440x900-day-integrations.png` `1440x900-night-integrations.png` 
- **onboarding**: `1440x900-day-1-welcome.png` `1440x900-day-3-accounts.png` `1440x900-day-4-project.png` `1440x900-day-5-preferences.png` `1440x900-night-1-welcome.png` `1440x900-night-3-accounts.png` `1440x900-night-4-project.png` `1440x900-night-5-preferences.png` 
- **firstrun**: `1440x900-day-2-tools.png` `1440x900-night-2-tools.png` 
- **inbox**: `1440x900-day-inbox.png` `1440x900-night-inbox.png` 
- **errors**: none (see gaps)
- **overlays**: `1440x900-day-bell-popover.png` `1440x900-day-command-bar.png` `1440x900-day-how-it-works.png` `1440x900-day-new-menu-items.png` `1440x900-day-new-menu.png` `1440x900-day-new-menu-scripted.png` `1440x900-day-project-switcher.png` `1440x900-day-project-switcher-scripted.png` `1440x900-day-quick-switcher.png` `1440x900-night-bell-popover.png` `1440x900-night-command-bar.png` `1440x900-night-how-it-works.png` `1440x900-night-new-menu.png` `1440x900-night-new-menu-scripted.png` `1440x900-night-project-switcher.png` `1440x900-night-project-switcher-scripted.png` `1440x900-night-quick-switcher.png` 
- **tools**: none (see gaps)
- **history**: `1440x900-day-history.png` `1440x900-night-history.png` 
- **about**: `1440x900-day-general-advanced.png` `1440x900-night-general-advanced.png` 
- **help**: none (see gaps)
