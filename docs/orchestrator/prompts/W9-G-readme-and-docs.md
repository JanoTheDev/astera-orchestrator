You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table) and
docs/orchestrator/USAGE.md. Read docs/orchestrator/DESIGN.md. Waves 9.0–9.3 are merged; the screenshots are in `assets/`.

Worktree + branch: slug `w9-docs`, branch `docs/readme-rewrite`. No `npm ci` needed unless you check CLI help.

# W9-G — README and docs for the product it is now

The README still describes upstream Astera with fork status tables bolted on. Rewrite for someone who has never
seen either.

- **`README.md`** (English only):
  - What Astera is in two sentences: you give it a goal or a source, a planner splits it, workers run it in
    parallel on the right model, a reviewer checks each Task, it delivers a PR or a push, and asks you only when it
    must.
  - Hero screenshot, then: the flow (add project → New plan → approve or talk → watch → inbox → delivery), the
    features grouped as the app groups them, install and run on Linux, the `astera` CLI in five commands, docs index.
  - Credit upstream [parsingk/Astera](https://github.com/parsingk/Astera) and keep the Apache-2.0 license section.
  - No wave/PR status tables; link the dev docs instead. No astera.run link (upstream's site).
- Delete `README.ko.md`, `README.ja.md`, `README.es.md` (owner, 2026-10-18).
- **`docs/`:** `docs/orchestrator/USAGE.md` becomes `docs/guide.md`, the user guide, reorganised by the new
  layout. For each upstream doc (`how-it-works`, `jobs`, `cli`, `usage-guide`, `sdk`, `mcp`, `plugins`,
  `remote-runtime`, `slack-bot-setup`, `releasing`, `code-signing`, `agent-workspace-isolation`,
  `release-notes`, the handoff note): keep and update, merge into the guide, or delete. Check every claim against
  the code and CLI help. Move the wave prompts, PLAN, SPEC, CONTEXT, LINUX, SECURITY-AUDIT into `docs/dev/` and fix
  every link that points at them (grep the repo, including prompts and skills under `resources/`).
- `package.json` `description` and `homepage` → the fork.
- Replace old assets the README no longer uses (upstream GIFs/MP4s) only after checking nothing else references
  them.

## Done means
- Table in the PR: each doc → kept / merged / deleted. No broken relative link (`grep` check or a link checker
  script, output in the PR). PR into `main`. Do not merge.
