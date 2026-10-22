# W12 · Settings › Projects and Integrations

Code-only redesign. Compare with `docs/dev/shots/w12-before/` (Settings › Projects, Settings › Integrations, the
project switcher's gear dialog, the Plans page's delivery line).

## What changed

### Settings › Projects (`settings/ProjectsSettings.tsx`)
- The project list was a hand-made listbox of buttons in a 180px column beside the body. It is now one ui `Select`
  (name, path as meta, repo icon) above the picked project's settings. **Moved:** the picker sits on top, not on the left.
- No projects: one `EmptyState` (repo icon, "No projects yet", one sentence, "Add project" as the filled primary).
  With projects, "Add project" is a secondary button in the header row and "New project" is ghost.

### Project settings body (`projects/ProjectSettings.tsx`, `projects/projects.css`; also the switcher's gear dialog)
- Fields grouped under quiet headings with a hairline between groups: **Delivery** (delivery line, attribution),
  **Plans** (approve automatically, hands-off, plan again between steps, keep in sync with origin, prompts folder),
  **Agents and checks** (agents at once, review rounds, test command, default account), **Sub-projects**
  (auto-create, add sub-project; only on a workspace root), then **Remove project** at the bottom.
  **Moved:** the order of fields changed to these groups (every field is still there).
- Checkboxes that apply at once are `Switch` (through `Field kind="toggle"`), each with a one-line hint.
- The two native selects (Replan, Origin sync) are ui `Select` through `Field kind="select"`.
- Hard-coded English (dialog title, Close, labels, placeholders, errors) now comes from i18n in en/es/ja/ko.
  Plain words: "Workers at once" -> "Agents at once"; "Replan between waves" -> "Plan again between steps"
  (option "Waves" -> "Between steps"); "at each wave" -> "at each step".
- The remove dialog keeps its ui `Modal` (it shows the core's refusal inside); its close button has a name.

### Delivery (`delivery/ProjectDelivery.tsx`; shown in project settings and on the Plans page)
- Native select -> ui `Select` (`dense`); branch input -> ui `Input`.
- Choosing "push" asked through `window.confirm`; now `confirmModal` (danger, title "Push without a review by a
  person?", confirm "Push to {branch}"). `useProjectDelivery().choose` keeps its signature (JobsView, PlanList).

### Integrations
- GitHub: buttons -> `Button` (install link with external icon, copy command with copy icon, re-check ghost with a
  spinner while checking); polling checkbox -> `Switch` (applies at once, row label still toggles it).
- CLI: Install is the filled primary until installed (then Reinstall, secondary, spinner while busy); Uninstall ghost;
  copy PATH line has a copy icon. The Windows "add to PATH" checkbox stays a checkbox (consent applied at Install).
- MCP: every raw button -> `Button` secondary small (copy lines, register, reveal/copy/new token keep their classes).
- Plugins: install-folder and the config form's Save are the primaries; row actions secondary small; Remove danger.
- Remote: Turn on / Make pairing primary (one visible at a time); Turn off, Revoke, Remove danger small; the rest
  secondary small; the clone-and-add button is secondary (was a second primary). The stop/revoke/remove confirms are danger.
- Creative hub: the platform picker is ui `Tabs variant="segmented"` (shown only with more than one platform).
- Higgsfield: buttons -> `Button`; workspace native select -> ui `Select`; remove confirm -> `ConfirmDialog` (danger).
- Strings: "Host" in this area's messages -> "background service"; "Pushes Run branches ... into Jobs" -> "plan
  branches ... into plans"; plugin permission "Run Jobs" -> "Start Jobs".

## Keyboard map

All controls are ui primitives with the shared `:focus-visible` ring. Tab follows visual order, top to bottom,
left to right.

- **Projects:** hint row -> Add project -> New project -> project picker (Enter/Space/ArrowDown/ArrowUp open; arrows,
  Home/End, typeahead move; Enter/Space pick; Esc closes the list only) -> Delivery select -> branch field (push only)
  -> attribution controls -> Approve automatically (Space) -> Hands-off (Space) -> Plan again select -> Origin sync
  select -> Prompts folder -> Agents at once -> Review rounds -> Test command -> default account -> Auto-create
  (Space) -> sub-project name (Enter adds) -> Add -> Remove project.
- **Remove project dialog:** focus trapped; Tab cycles Close, Cancel, Remove; Esc or the backdrop closes; focus
  returns to Remove project.
- **Push confirm (Delivery):** confirm button takes focus, Enter confirms, Esc cancels and the choice stays "pull request".
- **GitHub:** install / copy command (when shown) -> Re-check -> polling switch (Space).
- **Slack, Telegram:** unchanged (already ui primitives).
- **CLI:** Install/Reinstall -> Uninstall -> add-to-PATH checkbox (Windows) -> Copy.
- **MCP, Plugins, Remote:** same order as before; each former button is a `Button` in the same place. Selects open
  and move as above.
- **Creative hub:** segmented tabs, Left/Right move between platforms.
- **Higgsfield:** per row Use -> Copy login URL / Cancel / Log in -> Remove -> workspace select -> Pick; then the name
  field (Enter adds) -> Add -> Import. Remove opens a confirm: Enter removes, Esc cancels.

## Controls that moved
- Project list: from a left column to a Select above the body.
- Project fields: regrouped (see above); nothing removed.
- "Add project" is the empty state's action when there are no projects (still in the header otherwise).

## Not done / for promotion
- Destructive row actions (plugin Remove, Higgsfield Remove, remote Remove/Revoke) are still always visible, not on
  hover/overflow (DESIGN §7); left as is to keep them reachable without a new menu.
- `.settings-projects*` and `.jobs-delivery select` rules in files this Task does not own are now unused.
