You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/orchestrator/USAGE.md. Read docs/orchestrator/DESIGN.md and open its mockup. Waves 9.0–9.2 are merged. Run alone.

Worktree + branch: slug `w9-verify`, branch `fix/ui-redesign-polish`.

# W9-F — Walk every surface, fix, screenshot

1. Run the dev app (alone, CONTEXT rule 7). For each of the 4 themes, at the default and the narrowest sidebar
   width, go through every row of DESIGN.md's feature map and compare with the mockup. Check keyboard-only paths
   (rail, sections, inbox answer, box, dialogs, Plan tab sections) and the visible focus ring.
2. Fix what is off: layout, overflow, contrast, missing states (empty, loading, error). Move the hard-coded English
   of the orchestration panels into i18n. List each fix in the PR. Behaviour bugs unrelated to the redesign get a
   GitHub issue instead.
3. Run one tiny real plan end to end in a scratch repo (CONTEXT rule 7 cleanup afterwards) and check approve →
   Plan tab → inbox question → delivery reads right.
4. Save screenshots to `assets/` for W9-G: hero (Home + Plan tab, dark), light variant, Plan board, Inbox, New flow.

## Done means
- Feature map fully checked (table in the PR), screenshots committed, full suite via the flock line green. PR into
  `main`. Do not merge.
