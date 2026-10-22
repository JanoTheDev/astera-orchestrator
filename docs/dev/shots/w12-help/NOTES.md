# w12-help: the in-app help (T30)

Dev app on the dev profile, 1440x900, Night and Day. The PNGs are committed with this Task.

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
