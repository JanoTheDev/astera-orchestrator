# Before shots (T15)

Taken from the code at `caaea2cc` with `npm run shots -- --sizes 1920x1080,1000x800 --pages start,sessions,history,switcher,mainplan`
on the seeded profile (docs/dev/shots/SEED.md, "Plan shots"). Files: `<page>-<WxH>-<theme>.png`, themes night and day.
The problems below show in both themes unless noted. Input for the after-check: each one should be gone or deliberate.

## start-*: New plan page
- 1000x800: the Plans side bar opens over the page instead of beside it, so the left of the page is hidden: the title
  reads "at do you want done?", the project select, the text box start and the "Open a console instead" link are cut.
- 1920x1080: the form is a narrow column in the middle of the editor; the lower half of the page is empty.
- 1000x800: the composer's mode row (Plan with me / Plan and start on its own / Run my prompts as written) fills the
  full width and the "Paste or drop files to attach t…" hint is truncated at both sizes.

## sessions-*: Agents side bar
- The seed has no signed-in account, so the view shows its empty state ("No consoles are running in this project." and
  a full-width "Open a console" button). Live and waiting consoles are not shown; capture them by hand when an account exists.
- 1000x800: the side bar covers the editor's left 260px (the Welcome page "Astera / Start / Recent plans" is cut off).
- The Welcome page says "No plans in this project yet." while the Plans view lists 2 plans for the same project.

## history-*: History sessions tree
- The tree rows truncate at 260px: titles ("Why does the the…", "Fix the failing sav…") and the date column
  ("10/24,…") are cut, and the status dots (green, red asterisk) have no label.
- The project row reads "demo-app 10/24": a bare date with no word for what it counts.
- Work records is a second pane that is empty ("Nothing recorded yet") and takes half the height of the side bar.
- At both sizes the editor behind the tree is the Welcome page ("No plans in this project yet."), with nothing that opens a listed session;
  at 1000x800 the side bar covers its left half.

## switcher-*: project switcher (open menu)
- The title bar's search field truncates at 1000px ("Search or run a comm…").
- The `acme` workspace shows as one row; its `web` sub-project and the plan counts are not visible in the menu.

## mainplan-*: Main plan page
- Words glued together: the Task row and its state have no gap ("Add the settings formDone", "Wire the toggle into the
  headerAn agent is on it", "Pick the default themeWaiting for a person").
- "Checks failed" under "Settings page" has an hourglass icon, not an error icon, and no explanation.
- 1000x800: the Plans side bar covers the left of the page, so the plan names, the Task titles and their states are hidden;
  only the right-hand counts and the tails of the state texts show.
- 1920x1080: "2 of 3" / "1 of 4" sit at the far right edge, far from their plan names; the lower half of the page is empty.
