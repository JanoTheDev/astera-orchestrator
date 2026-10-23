# w12-help: the in-app help (T30)

Dev app on the dev profile, Night and Day, 1440x900 and 1024x640. The PNGs are committed.

## What it is
- `components/help/HelpPanel.tsx`: a ui `Modal` (lg). Left: search field and the topic list. Right: the chosen topic.
- Opens with F1 (`help.open` in `core/keys/binding.ts`, rebindable in Settings > Shortcuts), the top bar's More menu
  ("Help", below a separator) and the command box (type "help").
- Esc closes it; focus goes back to the button it opened from (checked: a ghost button in the top bar).
- 7 topics: getting started, plans and steps, agents and consoles, accounts and usage, delivering work,
  keyboard shortcuts (read from the key registry with the user's own bindings), words used in Astera (glossary).
- Search keeps the topics that contain every typed word (title, text, shortcut names and keys).

## Shots (`after/`)
- `<theme>-more-menu.png`: the More menu with the new Help row.
- `<theme>-help.png`: the panel on opening. `-help-search.png`: "pull request". `-help-shortcuts.png`, `-help-glossary.png`.

## After shots (T33)
- `after/<size>-<theme>-help.png`: F1 opens the panel (Getting started).
- `after/<size>-<theme>-more-menu.png`: the More menu (at 1024x640 the Pages menu) with the Help row.
- `after/<size>-<theme>-help-from-command.png`: Ctrl+Shift+K, typed `help`; the box lists the Help entry.
- No before shot exists for the help panel, because the panel is new (`before/NOTES.md` says what the old More menu and command box lacked).
- Topic length cap: `topics.test.ts` now checks every topic in en, es, ja and ko (words for en and es, characters for ja and ko). Largest topic: en 139 words, es 139 words, ja 357 characters, ko 290 characters. No topic needed trimming.
