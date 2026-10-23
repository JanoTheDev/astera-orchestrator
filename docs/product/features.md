# Features

What Astera does today, grouped by what a buyer cares about. Each line says what the feature does, where it is in
the app, and a tag for a pricing page.

**Tag key.** `core` = part of the base product, proposed. `pro candidate` = a suggestion for a paid tier; the owner
decides pricing. Nothing here is priced.

**Where.** Page names are the top bar's labels in a wide window. Below about 1100 px some pages fold into a Pages
menu. Settings groups are the names of the Settings sidebar: General, Accounts & usage, Agents, Projects,
Integrations, Notifications, Advanced, About.

**Checked.** Each claim was checked against the code on this branch, unless the Source column says `doc` (taken from
the README or a guide and not traced in code). A `doc` line needs a check before it goes on a price sheet.

## Plan and run work

| Feature | What it does | Where | Tag | Source |
| --- | --- | --- | --- | --- |
| Plan from a goal | You describe the goal; a planner writes a plan of Tasks, each with its own instructions, checks and affected paths. Nothing runs until you approve. | Start (“What do you want done?”), then Plans | core | `src/core/orchestration/` |
| Approve or talk to the planner | Read the plan, ask the planner for changes, then approve. Agents cannot approve a plan; only you can. | Plan page; Inbox “Approvals” | core | README “Inbox” |
| Run as written | Approved Tasks run in dependency order, each in its own git worktree, with workers. | Plan page; Tasks | core | `run-start` (CLI) |
| Reviewer on every Task | A reviewer checks each Task's output; up to 5 review rounds, then a final check against the goal. | Plan page, Tasks board | core | `MAX_REVIEW_ROUNDS` (`src/core/orchestration/types.ts`) |
| Wave replanning | Between waves the plan can be revised based on what finished. | Plan page, Overview and Waves | core | `src/core/orchestration/` |
| Tasks board | Every Task across plans in one board, with why a Task waits. | Tasks | core | `taskBoardsOf` (`src/core/orchestration/blocked.ts`) |
| Plan overview, waves, files, changes, journal | Per plan: its steps, files it touched, who wrote each change (agent or you), and a journal of events. | Plan page tabs | core | Plan page shots, `docs/dev/shots/w12-plan/` |
| Pause, stop, rename, archive, queue | Pause or stop a plan or one worker; rename, archive and unarchive plans; queue a plan behind another; set a priority. | Plans list; plan header | core | README “Tasks and Plans” |
| Usage guard | No new worker starts on an account at or over its limit (default 90%); it starts on the next account. | Settings › Accounts & usage; plan runs | core | `USAGE_PAUSE_AT_DEFAULT` (`src/core/orchestration/usageGuard.ts`) |
| Per-role models | Coordinator, planner, workers and reviewer can each run on their own model. | Settings › Agents | pro candidate | `resolveRoleModel` (`src/core/models/`) |
| Workers at once | An app-wide cap on parallel workers, and a per-plan value. Up to 100. | Settings › Agents (“Workers at once”); plan header | core | `MAX_CONCURRENT_WORKERS = 100`, `MaxWorkersSetting.tsx` |
| Scheduled work | Jobs can be scheduled to start later. | Plans | pro candidate | `doc` (`docs/usage-guide.md` “Schedule work”) |
| Run configurations | Saved commands (dev server, build, test) you run from a panel. | More › Run configs; bottom panel | core | `docs/usage-guide.md` “Run a dev server”; run-configs shots |

## Agents and consoles

| Feature | What it does | Where | Tag | Source |
| --- | --- | --- | --- | --- |
| Agents wall | Every console of the project as a live tile, showing the real terminal. | Home (Agents wall); Agents | core | README “Agents” |
| Full console | Open one console full size and type into it. | Agents; any tile | core | `src/renderer/src/components/conversation/` |
| Your typing is safe | While you type in a console, the coordinator's messages to it wait, so they do not land in your line. | Full console | core | README “Agents” |
| Finished-console summary | A finished console leaves a short card of what it did. | Agents wall | core | README “Agents” |
| Consoles in tabs and windows | Consoles open as tabs; each project can have its own window, side by side. Closing a window stops nothing; the Host keeps the sessions. | Tab strip; More › new window | core | README “Accounts and windows” |
| Waiting for permission | An agent that hits a permission prompt stops and shows “waiting for permission” until you answer. | Agents; Inbox “Permissions” | core | `src/core/` activity lines; CONTEXT rule 7 |
| Run without permission checks | Turns off the permission prompts for agents. Off by default. | Settings › Agents (“Run agents without permission checks”) | pro candidate | `settings.agentPermission.label` (en) |
| Push-to-talk voice | Speak a command or message; a local whisper.cpp model turns it into text. Nothing is downloaded. | Command bar (voice toggle) | pro candidate | `src/core/intents/transcribe.ts`, `VoiceSettings.tsx` |
| Design Mode and browser pane | A built-in browser pane for a local dev server, with a Design Mode to point at elements and leave feedback for an agent. | More › Browser; browser toolbar | pro candidate | `docs/usage-guide.md` “Design Mode”; `w12-history` shots |

## Accounts and usage

| Feature | What it does | Where | Tag | Source |
| --- | --- | --- | --- | --- |
| Several accounts per vendor | Add, detect, import, rename and remove Claude and Codex accounts. Each lives in its own config folder. | Accounts popover; Settings › Accounts & usage | core | README “Accounts and windows” |
| Usage meters | Shows the 5-hour and weekly usage of each account, with percentages. | Account popover; Settings › Accounts & usage | core | `AccountUsageMeter.tsx`, `src/core/usage/` |
| Account rolling | When a session hits a usage limit, Astera reads the reset time and resumes the work on the next account. | Automatic, when enabled in the account settings | pro candidate | README “Accounts and windows” |
| Sign in from the app | Sign-in dialog opens the vendor login in your browser, with the code box. | Accounts popover, Add account | core | `AccountSignIn.tsx` |

## Files and review

| Feature | What it does | Where | Tag | Source |
| --- | --- | --- | --- | --- |
| File explorer and editor | Browse the project tree, open and save files, find in a file. | Files | core | `FileExplorer.tsx`, `FileEditor.tsx` |
| Markdown view modes | Markdown files open as editor, split (editor and preview) or preview. | Files; file header “View mode” | core | `files.markdown.mode.*` (en) |
| Changed view | Lists every changed file of a worktree or plan, with its diff. | Files › Changed | core | `ChangedFilesView.tsx` |
| Local History | Keeps a copy of a file before a delete or overwrite, so you can get it back. | Files; right-click › Local History… | core | `files.op.snapshotting` (en) |
| Worktrees | One git worktree per worker, with its branch, commits, changes and an unpushed-commit count. Clean up or delete from here. | Worktrees | core | README “Worktrees and Files”, `w12-worktrees` shots |
| Sessions history | Lists past sessions per project and reopens one. | More › History | pro candidate | `docs/usage-guide.md` “Reopen an earlier conversation” |
| Code map | Reads a session and writes up what it changed, decisions and files. | More › History (code map) | pro candidate | `src/core/sessions/summary.ts`, `UnderstandingView.tsx` |

## GitHub delivery

| Feature | What it does | Where | Tag | Source |
| --- | --- | --- | --- | --- |
| Pull request for a Task or plan | Opens a PR from a worktree's branch, after a dialog that lists the commits. Astera never merges it. | Plan page (delivery chip); Create PR dialog | core | `CreatePrDialog.tsx`, `docs/product` line “never merged by Astera” (`docs/usage-guide.md`) |
| Issues and PRs linked to plans and Tasks | A Task can link an issue; a run records its PR; badges show PR and push state. | Plan page; Tasks; Worktrees badges | core | `src/core/github/taskLinks.ts` |
| Start from an issue or source | Create a plan from a source item, such as a GitHub issue, with a lead agent and the choice of account. | New menu › From a source | pro candidate | `SourceJobModal.tsx`, `src/core/sources/` |
| Checks on a PR | Shows the status of PR checks in the run view. | Run detail; PR view | core | `prChecksArgs` (`src/core/github/`) |

## Integrations

| Feature | What it does | Where | Tag | Source |
| --- | --- | --- | --- | --- |
| Claude and Codex as agents | Runs Claude Code and Codex CLI sessions for agents. Needs the CLI installed and signed in. | Settings › Integrations › CLI; onboarding | core | `docs/dev/LINUX.md` prerequisites |
| `astera` command | Drives the same Host from a shell: start plans, list status, answer. | Any terminal | pro candidate | `docs/cli.md` |
| MCP server | Exposes the Host to MCP clients. | Settings › Integrations › MCP | pro candidate | `docs/mcp.md`, `McpSettings.tsx` |
| TypeScript SDK | Build your own tools on the Host. | Code | pro candidate | `docs/sdk.md` |
| Plugins | Add job sources and notifiers that run beside the Host. | Settings › Integrations › Plugins | pro candidate | `docs/plugins.md`, `PluginsSettings.tsx` |
| Slack and Telegram bots | Receive notices and answer from a chat. | Settings › Integrations (Slack, Telegram) | pro candidate | `docs/slack-bot-setup.md`, `docs/telegram-bot-setup.md` |
| Remote runtimes | Run sessions and plans on another machine over your own LAN, VPN or Tailscale. No Astera relay. | Settings › Integrations › Remote runtimes | pro candidate | `docs/remote-runtime.md`, `RemoteRuntimesSettings.tsx` |
| Creative hub and Higgsfield | Connect creative platforms (Higgsfield sign-in, creative hub). What they feed is not traced in this pass. | Settings › Integrations | pro candidate | `doc`: settings pages `HiggsfieldSettings.tsx`, `CreativeHubSettings.tsx` exist; purpose not checked |

## Settings

| Feature | What it does | Where | Tag | Source |
| --- | --- | --- | --- | --- |
| Eight settings groups | General, Accounts & usage, Agents, Projects, Integrations, Notifications, Advanced, About. Search across all rows. | Settings | core | `SETTINGS_GROUPS` (`settingsIndex.ts`) |
| Simple and advanced mode | Hides advanced rows until you turn advanced mode on. | Settings; search reveals them | core | `settingsIndex.ts` (`level`) |
| Languages | English, Spanish, Japanese and Korean for the whole UI, including in-app help. | Settings › General (Language) | core | `src/core/i18n/messages/` |
| Day and Night themes | Two themes; a theme card per choice. | Settings › General | core | `docs/usage-guide.md` “Adjust appearance” |
| Keyboard shortcuts | View and change shortcuts; the quick switcher and command bar are keyboard-first. | Settings (shortcut list); Ctrl+Shift+P (quick switcher) | core | `src/core/keys/binding.ts`, `ShortcutSettings.tsx` |
| Projects | Per-project defaults: workers, review rounds, delivery. | Settings › Projects | core | `ProjectSettings.tsx` |
| Notifications | Choose which events notify you; the bell shows what Astera handled. | Settings › Notifications; bell | core | `NotificationsSettings.tsx` |

## Updates and reports

| Feature | What it does | Where | Tag | Source |
| --- | --- | --- | --- | --- |
| About page | App name and version, build, CLI versions, background service, accounts, update, crash reports, license, open source licenses. | Settings › About | core | `AboutSettings.tsx` |
| Update channel | Release builds update from GitHub Releases, on the stable or the beta track. | Settings › About (“Update channel”, release builds only) | core | `docs/releasing.md`, `updateChannel.ts` |
| Source-build updates | A build made from a git checkout checks `origin/main` every 30 minutes and can build the new version. | Settings › About (source builds only) | pro candidate | `sourceUpdate.ts` |
| Crash reports with consent | On an error, Astera asks whether to send a report. You read it first. Send opens a new GitHub issue in your browser with the report filled in. Astera sends nothing itself. Ask or Never. | About (“Crash reports”); error prompt | core | `src/core/crash/`, `CrashReportPrompt.tsx` |
| Open source licenses | Lists the licenses of the software Astera ships, with full text. | About › Open source licenses | core | `LicensesView.tsx` |
| In-app help | Help panel with topics, search and keyboard support. | F1; More › Help; command bar | core | `src/renderer/src/components/help/HelpPanel.tsx` |

## First run

| Feature | What it does | Where | Tag | Source |
| --- | --- | --- | --- | --- |
| Onboarding | Welcome (language), accounts, project, preferences, tools. Skip any step. | First launch | core | `components/onboarding/` |
| Tools step | Shows git and gh, and installs Claude Code or Codex from its vendor's installer, with live output and retry. | Onboarding › Tools; Settings › Integrations › CLI | core | `src/core/install/cliInstall.ts` |
| Works with no agent CLI | Starts with no CLI installed; shows a banner and disables Start until a CLI is there. | App; Start | core | `docs/dev/LINUX.md` “First run on a clean machine” |
