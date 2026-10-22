# W12 Inbox, bell, activity feed, update gate

## What changed
- InboxPage: lucide imports gone (`Icon name=...`: done/error/warning/pending tone icons, terminal, close, inbox EmptyState). Handled-feed rows are ui `Button variant="ghost"` (were raw `<button>`); layout lives on `.ui-btn__label` in `inbox.css`.
- NotificationBell: bell glyph through `Icon name="notifications"`; recent-line rows are ui `Button`s (still `data-roving`). Row layout CSS for `.bell__line` added to `inbox/inbox.css` (shell.css is not ours; it is imported by the bell).
- ActivityPanel: toggle, "All plans/This plan" and feed rows are ui `Button`s; chevrons via `Icon`; every hard-coded English string now `activity.panel.*` / `activity.bucket.*` keys (en, es, ja, ko).
- UpdateGate: four raw buttons → ui `Button` (one filled primary: install / download / retry, ghost "Quit app"); dialog gets `aria-labelledby`/`aria-describedby`; primary autofocuses (Enter installs). Retry shows a spinner while downloading instead of a disabled button.
- Update strings: unchanged (already plain words).

## Keyboard map
- Inbox: Tab → group tabs (arrows move between tabs) → plan chip close (when filtered) → each need card's buttons in visual order (answer options, Open console / Open plan, or Review plan / Talk to planner / Approve) → handled rows (Enter/Space opens the console). Focus ring on every control (ui `:focus-visible`).
- Bell: opener button; Esc closes and refocuses it; arrows walk `data-roving` controls (All projects, Mark all read, row actions, recent lines, View all).
- Activity: Tab → section toggle (Enter/Space collapses) → All/This plan → bucket `<details>` summaries → feed rows.
- Update gate: Tab → primary → Quit app. No Esc (blocking by design).

## Moved controls
None.

## Not done / for the report
- `.panel-toggle`, `.ws-link` still styled by worktrees.css (other screen); the Button's own sizing sits under it.
- Summary `<details>` in the Activity panel are native disclosure elements (no ui primitive; `Section` persists state by id, not fit for per-bucket lists).
