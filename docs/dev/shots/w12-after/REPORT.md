# W12 after shots and visual check (T33)

Dev app (electron-vite dev) on the seeded dev profile `~/.config/astera-dev` (`node scripts/shots-seed.mjs`), one Electron at a time, driven over CDP.
Sizes 1440x900 and 1024x640, Night and Day. PNGs: `docs/dev/shots/w12-<screen>/after/<size>-<theme>-<name>.png`.
Before shots: `w12-before/<screen>/`. For the gap screens (plan, errors, tools, context menu, New task, Create PR, About) there is no before shot: they are judged against `DESIGN-W11.md` alone.
Onboarding and first run were shot on a fresh profile with an empty `HOME` and `PATH` without `claude` (the T29 setup); their theme was set on the page (`data-theme`), not through Settings.
Not shot: the quick switcher (see "Left"), the render-error screen and the crash prompt (nothing triggers them without breaking the app).
Settings pages were shot in simple mode, then Agents, Advanced and About (which need it) in Advanced mode. Home shots show "No consoles": no agent was started.

## Per screen

| Screen | Before vs after | Keyboard walk | Fixed | Left |
|---|---|---|---|---|
| shell (`w12-shell`) | Top bar is now project switcher, Home/Plans/Files/More, search, bell, account meter, New, settings. At 1024 the page tabs fold into one "Home ▾" Pages menu and the search text goes. Status bar groups consoles / needs you / account / Connected. | Tab: switcher, pages, More, search, bell, account, New, Settings, window buttons, page, status bar. Ring on every stop. | none | none |
| agents (`w12-agents`) | Same Home page as shell (one empty state, one primary). Page header is still the word "Agents" alone. | Same as shell, then New console. | none | none |
| start (`w12-start`) | "What do you want done?": project Select, prompt, topic chips, mode control with a one-line explanation, More options, primary at the bottom. | not walked | none | none |
| plans (`w12-plans`: plans, tasks) | Plans list shows both seeded plans with status, step, progress and the delivery/needs-you line. Tasks kanban: Planned 2, Needs you 2, Done 3. | Plans: tabs, then the list. | none | Kanban scrolls sideways under 1100px (`plan.css`, 5 x 220px) and cuts the Done column at 1024. Needs a layout redesign (collapse columns). Plans row: the plan name "Settings pa…" is cut by the long failure chip (`PlanRow.tsx`). |
| plan (`w12-plan`: failed, paused) | No before. Failed: delivery chip, Retry delivery / It's already pushed / Dismiss, step cards, failed Task. Paused: step cards, the owner question with its answers. | Back to Plans, Its consoles, Resume, More, step, task, the three answers, textarea, next task, Show details, status bar, top bar. | The overview strip stretched to the page height, so the progress bar floated in a blank block and the steps sat at the bottom (`planPage.css`: `.detail-graph > .plan-overview { flex: none }`). A long "Not delivered: …" chip squeezed the title to "Set…" and was clipped; title and chips now wrap. "1 attempts" reads "1 attempt". | none |
| inbox (`w12-inbox`) | Needs you card with answer buttons and Handled for you log, red and warning rows. | All tab, answers, textarea, Open plan, status bar, top bar. Handled rows are not focusable (plain text). | At 1024 the Needs you card ran over the "Handled for you" heading (grid rows shrank below their content, `inbox.css`). Fixed with `min-height: auto` for the stacked layout. | none |
| errors (`w12-errors`) | No before (the before profile had none). Shot: Files on a project whose folder is gone, now "This folder no longer exists." Failed rows are in the Inbox shots; the failed plan is in `w12-plan`. | not walked | The Files note read "Read failed: Error invoking remote method 'files.list'…" and was cut at the panel edge. `useFileTree.ts` now strips the IPC prefix (`errText`), `FileExplorer.tsx` says the folder is gone for ENOENT (en, es, ja, ko). Test: `hooks/useFileOps.test.ts`. | The project is still selectable: `scopeRoot` in `useJobs.ts` is never dropped when its folder is gone (state file, outside this Task's paths). Render-error screen and crash prompt: not reachable, not shot. |
| files (`w12-files`) | Explorer lists the seeded repo (before: only the read failure). Context menu: New File/Folder, Rename (F2), Duplicate, Delete (Del), Cut, Copy, Paste, Local History, Copy Path, Reveal. | not walked | none | Explorer header icons have no visible label (tooltips only). |
| worktrees (`w12-worktrees`) | One row `shots/settings-page ↑1`, detail with plan, tree, unpushed commits, path, changes, commits. | not walked | none | The filter icon and the × at the top right have no label. |
| accounts (`w12-accounts`) | Popover: account name now shown in full, Default chip, 5h and Weekly bars with percent. Settings › Accounts & usage: the account row with the same bars. | not walked | none | "Use for this tab" is still a faint text button. |
| settings (`w12-settings`: General, Projects, Notifications, Agents) | Groups of rows, Switch and Select primitives, theme cards. | Back, search, nav (one stop each), then the first row's controls, theme cards. The search box shows its ring on the wrapper. | The Projects intro said "workers at once" and "replanning between waves" (internal words). Now "agents at once" and "planning again between steps" in en, es, ja, ko. | none |
| integrations (`w12-integrations`) | Remote runtimes card: address Select, Turn on, paired controllers, Add a machine. | not walked | none | none |
| onboarding (`w12-onboarding`: welcome, accounts, project, preferences) | Welcome with language Select, then one column per step, progress dots, Back / Skip setup / primary. | Step 6: Go to Agents, Install an agent tool. Focus used to leave the page for the title bar and the app behind it. | Tab now wraps inside the page (`Onboarding.tsx`, same rule as a Modal). | none |
| firstrun (`w12-firstrun`: tools, tools-command, done) | No CLI: both tools with Install and Show command, git and gh detected, Skip for now beside a disabled Next, done step names what is missing. The 11 T29 shots stay in the folder. | See onboarding. | At 1024x640 the tools step is taller than the window and Back / Skip / Next were scrolled out of sight: the footer is now sticky (`onboarding.css`). | The installing / failed / installed states were not re-shot: they need the stub installer (T29 shots cover them). |
| overlays (`w12-overlays`: new menu, project switcher, bell, command bar, context menu, New task, Create PR, How it works) | New menu: three cards and "Open a console instead". Switcher: project list with Ctrl+Alt+n keycaps. Bell: Needs you with Answer, Recent, View all. Command bar is a Modal with the field, mic and hits. Create PR: branch, base Select, title, description, draft, push note, commit count. | New menu: three cards, close, wraps. Command bar and help: Modal trap, Esc closes. | The command bar placeholder was cut mid-word at its edge; inputs now end it with an ellipsis (`primitives.css`, `command.css`). Create PR said "1 commits will be in…": now "1 commit" (en, es, ja, ko). | New task form is inline in the plan page: at 1024x640 it squeezes the step board to two rows (`NewTaskModal`, needs a redesign). The quick switcher has no shot: it opens only when a tab exists, and in this window its dialog stayed at the start of its animation (0x0, opacity 0). Not judged. |
| tools (`w12-tools`: run-configs, run-started) | No before. Run configs page with the bash config, run, stop, menu, running count; bottom panel with the live shell. | not walked | none | A started shell keeps the next Ctrl+digit chord: the terminal takes it (known, `SEED.md`). Shots reload the page first. |
| history (`w12-history`) | PageHeader with count and refresh, account filter, project rows. | not walked | Project name and date ran together ("…every10/23, 08:56 AM"): the Button label span was not a flex row (`history.css`). | none |
| about (`w12-about`) | Before (73fe2514 build): the info card at the bottom of Advanced. After: Advanced without it; About group with name, version, build with Copy, CLI versions with Reinstall/Install, background service, accounts, update, crash reports, license, licenses View; licenses window with search and full text. | not walked | none | The licenses text wraps the source's own hard line breaks (`LicensesView.tsx`). |
| help (`w12-help`) | New. F1, the More menu (Help row) and the command box all reach it. No before shot, the panel is new. | Search, seven topics, Close; Tab wraps. Esc closes. | none | none |

## Defects fixed (all in `src/renderer/src` or i18n)
1. `components/plan/planPage.css`: overview strip no longer stretches; title and chips wrap.
2. `components/history.css`: project row name and date spaced.
3. `components/inbox/inbox.css`: stacked Inbox columns keep their own height.
4. `components/onboarding/onboarding.css`, `Onboarding.tsx`: sticky footer, Tab trap.
5. `hooks/useFileTree.ts`, `components/FileExplorer.tsx`, `explorer.dir.missing`: readable missing-folder note (+ `hooks/useFileOps.test.ts`).
6. `plan.card.attempts.one`, `pr.create.commits.one` (+ es and ja for the base keys; both left `UNTRANSLATED` in `coverageAllowlist.ts`).
7. `settings.projects.hint` in four languages: no "workers" or "waves".
8. `styles/primitives.css`, `command/command.css`: long placeholders end in an ellipsis.
9. `help/topics.test.ts`: length cap for en, es, ja, ko (200 words for en and es, 400 characters for ja and ko). Largest topic: en 139, es 139, ja 357, ko 290. Nothing trimmed.

## Internal terms
No unexplained Run, Dispatch, Gate, wave N, Coordinator or Host showed in the shots. "Run configs" and "Run" are the commands' own names. "Background service" replaces Host. The Projects hint was the one place that still said waves and workers (fixed).

## Left (each needs a redesign or sits outside the Task's paths)
- Kanban sideways scroll under 1100px (`components/plan/plan.css`).
- Inline New task form crowding the board at 640px high (`components/plan/NewTaskModal.tsx`).
- Plan name cut in the Plans list row (`components/plan/PlanRow.tsx`).
- Stale `scopeRoot` (`src/renderer/src/state/useJobs.ts`): a project whose folder is gone stays selected.
- Quick switcher, render-error screen, crash prompt not shot.
- Keyboard walk not done for start, files, worktrees, accounts, integrations, history, tools, about.

## Environment notes
- The seeded dev profile was left in Night with Advanced mode off. The 73fe2514 build ran against the same dev profile folder (its own `-dev` rule overrides `ASTERA_PROFILE_DIR`), once, for the two About before shots.
- Electron processes started here were stopped; the dev profile's and the fresh profiles' Hosts were stopped.
