# w12 onboarding and first run

## What changed
- Onboarding, CliMissingScreen, CliInstallRows: every raw `<button>` is now ui `Button`; glyph/lucide icons are `Icon` (check, pending, folder, add, warning, chevronUp/Down).
- Welcome language picker: ui `Select` in the `items` form (was native `<option>` children).
- Preferences (terminal / chat): radio group now has a roving tabindex and arrow keys.
- CliMissingScreen: each tool is a `Card`; "Restart Astera" is the one primary; the language links became a `Select`; failure line has a warning icon and `role="alert"`; command and details toggles are ghost buttons with `aria-expanded`. Installer commands stay one click behind "Show command"; installer output opens by itself on failure (unchanged).
- cliMissing.css: spacing/typography through tokens; old `.cli-missing-link` / `-primary` styles removed.
- Wording: "Host" is now "background service" in the four host status strings; new key `onboarding.stepsLabel` (progress group name) in en/es/ja/ko.
- Install logic (`useCliInstall`), HostRuntimeNotice and MachineSteps untouched in behaviour.

## Keyboard map
- Onboarding: Tab order = step content, then Back, Skip setup, primary action (Next / Get started / Go to Agents, Start your first plan). Esc skips setup (unless a dialog or the language list consumed it). Focus moves to the step heading on every step.
- Welcome language Select: Enter/Space/Arrows open; arrows/Home/End move; Enter picks; Esc closes only the list.
- Preferences radio group: one Tab stop (the selected choice); Arrow keys change and focus the choice.
- CliMissingScreen: Tab through Install (Claude Code), Show command, Install (Codex), Show command, Details, language Select. Esc closes the language list.

## Moved controls
- CliMissingScreen language switch: row of links -> one Select, same place (bottom).
- Sign-in buttons lost their LogIn glyph (not in the icon registry). Promote `login` to `ICONS` if wanted.
