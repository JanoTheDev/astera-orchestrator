# Account center redesign (T4)

Shots at 1440×900, Night and Day: `*-accounts-popover.png` (activity bar › Accounts), `*-settings-accounts-usage.png`
(opened from the popover's "Manage accounts…"), `*-settings-row-menu.png` (a row's ⋯ menu).

## How they were taken
`npm run shots` could not be used on this Windows machine: `scripts/shots-seed.mjs` fails on a Windows path (a colon in a
Claude projects folder name, and git's path limit), and `astera heavy` needs `flock`. So a throwaway profile was written
by hand: four accounts (Work = Max, Studio = Ultra, Lab = an unrecognised plan string `galaxy_beta`, Codex). Their
credentials files hold only the plan fields and no token. Remembered usage readings were added for the three Claude
accounts, Studio's with a weekly window only. One dev Electron ran on a fresh CDP port, driven by the same CDP steps as
`scripts/shoot.mjs`. The profile was deleted afterwards and its Host stopped.

## What changed
- One row on both surfaces (`AccountList` / `AccountRow`). The first line is the colour mark, name, provider, plan chip
  and one state chip. The second line is the email, "Default" and "Active". Under them sit the usage meters.
- Plan chip: the plan by name (Ultra, Max, ...), the raw string for a plan it does not recognise, and nothing when no
  plan could be read (Codex).
- State chips, each with an icon and a word: Signed in (check), Not signed in (lock), Sign-in expired (warning, with a
  hover hint), Status unknown (info, with a hover hint), Paused (pause). The shots show only Signed in and Not signed in;
  the other three come from main's probe and are covered by `AccountRow.test.ts`.
- No 5-hour window (Ultra, or a reading with only a weekly window): the 5h track, the "5h" figure in the account picker
  and Start's "5h —" are left out (`sessionWindow.ts`). In the shots, Studio shows only its weekly track.
- The active account: the one the open tab runs on, or else the one the status bar shows. It gets an accent edge,
  `aria-current` and "Active".
- Popover: one toolbar (Add, Import folder, Find signed-in accounts), then the rows, then "Manage accounts…" →
  `view:settings:accounts`.
- Settings: the same three actions as worded buttons, using the same dialogs (`accountModals.tsx`). The empty state
  has an Add button, and its text no longer points to the top bar.
- Signed-out and expired rows have an inline "Sign in" / "Sign in again" button on both surfaces.

## Keyboard map
- Popover: Tab reaches the toolbar first (one stop; Left/Right move between Add, Import and Find). Then each row in
  turn: the row itself when it has usage (Enter/Space opens the detail), Sign in (on a signed-out or expired row), then
  ⋯. Last comes Manage accounts…. Esc closes the popover.
- Settings: Add, Import, Find. Then each row in turn: the row, Sign in, Import settings, ⋯. Rename is in the ⋯ menu,
  and double-clicking the name still renames. Enter saves the new name and Esc cancels.
- Dialogs keep their `Modal` focus trap. Esc closes them and Enter submits forms.
