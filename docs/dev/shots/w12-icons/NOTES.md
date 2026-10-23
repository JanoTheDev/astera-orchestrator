# W12 icons: one icon set, one Checkbox

Every icon outside `components/ui` now comes from the `ICONS` registry (`ui/Icon.tsx`), and every checkbox is the ui
`Checkbox` (`ui/Checkbox.tsx`). `oneOffs.test.ts` has two new rules, "lucide-react import" and "raw checkbox", so the
guard fails on either. `EmptyState` takes registry components (`icon={ICONS.tasks}`).

Shots (dev profile seeded by `scripts/shots-seed.mjs`, 1920x1047): `{night,day}-settings-general.png` (the nav glyphs
agent, projects, integrations, advanced are promoted ones) and `{night,day}-new-session.png` (every checkbox is the
primitive; look and focus ring unchanged from the native box styled in `styles/select.css`).

## Glyphs promoted into ICONS

| Name | Lucide glyph | Used by |
|---|---|---|
| active | CircleDot | JobIcons (running Task) |
| advanced | Wrench | SettingsPage nav |
| agent | Bot | SettingsPage nav |
| arrowDown / arrowUp | ArrowDown / ArrowUp | WorktreeDetail, PushBadge |
| backspace | Delete | BottomPanel clear |
| checked / unchecked | CheckSquare / Square | FullConsole criteria |
| chevronLeft | ChevronLeft | HistorySettings |
| clear | Eraser | RunToolRail |
| collapseAll | ChevronsDownUp | FileExplorer |
| draft | PenLine | TasksPage (Task still drafting) |
| fileAdd | FilePlus | FileExplorer |
| files | FileStack | TasksPage wait kind |
| hold | Hand | JobsView, PlanRow |
| image / video / screen | Image / Film / Monitor | WorkbenchTabs |
| integrations | Plug | SettingsPage nav |
| issue | CircleDot | TaskLinkChips |
| keyboard | Keyboard | FullConsole header |
| licenses | ScrollText | LicensesView empty state |
| limit | Gauge | TasksPage wait kind |
| login | LogIn | onboarding and account-row sign-in buttons (restored) |
| matchCase / regex / wholeWord / selectText | CaseSensitive / Regex / WholeWord / TextSelect | FileFindBar |
| mic | Mic | CommandBar |
| moreVertical | EllipsisVertical | RunToolbar |
| ordered | ListOrdered | PlanHeader, TasksPage |
| panelLeft / splitView | PanelLeft / Columns2 | MarkdownSplit |
| panelRightClose / panelRightOpen | PanelRightClose / PanelRightOpen | FullConsole details toggle |
| pause | Pause | JobIcons |
| projects | FolderKanban | SettingsPage nav |
| pullRequestClosed / pullRequestDraft | GitPullRequestClosed / GitPullRequestDraft | PrBadge |
| queued | CircleDashed | JobIcons |
| release | PlayCircle | PlanRow |
| repeat | Repeat | WorkbenchTabs |
| replace / replaceAll | Replace / ReplaceAll | FileFindBar |
| rerun | RotateCw | RunToolRail |
| reset | RotateCcw | ShortcutSettings, PlanRow (restart coordinator) |
| scrollToEnd | ChevronsDown | RunToolRail |
| serverOff | ServerOff | JobsView, PlanList empty states |
| stopFix | WrenchOff | PlanGraph |
| unlock | LockOpen | JobIcons, PlanGraph |
| waiting | Hourglass | MainPlan |

Reused existing names (no new entry): archive, restore, open, chevronDown, chevronRight, more, edit, run, delete, folder,
add, filter, warning, tasks, layers, lock, users.
