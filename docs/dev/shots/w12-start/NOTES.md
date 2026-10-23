# w12-start: Start page and New dialog

## What changed
- Start header is the house `PageHeader` (Back as `leading`, title "What do you want done?"); the hand-made `.start-head`/`.start-title` are gone.
- The goal box is the house `Textarea`; every icon on Start and New goes through `Icon name=...` (no direct lucide imports).
- New dialog: cards use registry icons (message, run, file, chevronRight); the console link uses the `terminal` icon.
- Schedule fields (Start's "Repeat on a schedule" and the session dialogs that share them): the old `components/Select` import is now ui `Select` (with an accessible name), number/text/time/command inputs are ui `Input` with aria-labels, and the weekday toggles are ui `Button`s with `aria-pressed` (class `weekday on` kept so terminal.css still styles them).
- Plain words in en/es/ja/ko `start.ts`: consoles -> agents, workers -> agents, wave -> step, "run" -> plan (schedule overlap hint), "Next waves" button -> "Next prompts" (it still types `next waves`, which the Host understands).
- Features kept: project picker, starter chips, 3 planning modes, account, start-after, agents at once, delivery, plan-again, hands-off, schedule, GitHub issues, attach file, prompt-name lookup, drag and drop, Ctrl+Enter, "Open a console instead".
- No control moved.

## Keyboard map
Start page, Tab order = visual order: Back, Project (Enter/Space/arrows open, arrows/Home/End/typeahead move, Esc closes the list only), goal box (Ctrl+Enter starts; Enter = newline), attached-file remove buttons, Attach / Next prompts (Run-my-prompts mode only), starter chips, "How should it be planned?" segmented tabs (arrows move), More options (Enter/Space toggle; its fields follow in order: account, start, agents at once, delivery, plan again, hands-off switch, schedule switch + schedule fields), Open a console instead, Start button.
New dialog: Modal traps focus; Tab goes through the three cards then "Open a console instead"; Enter/Space activates a card; Esc or the close button closes.

## For the visual check
Start header spacing under PageHeader, goal box without double border (`.start-composer .start-text`), weekday buttons look in the schedule row, New cards' icons.

## Known gaps
No screenshots (per task). `lookup` preview rows and `start.audit`/`start.issues` CSS left over from older layouts are untouched.
