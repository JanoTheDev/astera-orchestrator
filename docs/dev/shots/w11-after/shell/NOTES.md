# W11 after: the shell

Taken with `npm run shots` (dev profile, project "w7c-scratch" open, no consoles, one account) at 1440×900 and
1024×640 in Night and Day. Only the shell shots are kept here: `01-agents` (bar at rest), `10-new-menu`,
`11-project-switcher`, `12-accounts`. Pages themselves are unchanged; later Tasks restyle them.

Compared with `w11-before/NOTES.md` ("Problems on every page"):
- Project switcher sits top-left after the 18px mark as a real button (`● name ▾`), no "/" or "⇅" glyph. Its menu
  has a search field, "All projects" separated from the project rows, a check on the current project, counts only
  when > 0, `Ctrl+Alt+N` hints, per-row new-window/settings actions on hover, then New/Add project.
- A hairline separates the switcher from the page tabs; tabs are 13px/500 dim with the active one in `--text` and an
  accent underline. At 1024 they still fold into one menu (unchanged rule).
- Right group in a fixed order: search (field-shaped, `Kbd` caps), usage (label, small meter, percent), New (the one
  filled accent button), settings icon button (marked while Settings is open).
- Status bar is sans 12px on `--panel`: consoles count (or "No consoles"), "n working" and "n needs you" only when
  non-zero, the next queued plan; right: account, "5h 1% · week 76%" as words with the reset in the title, and the
  Host as a word ("Connected" / "Host offline" in warn). Usage meters are gone from the status bar, so the top bar is
  the only meter.
