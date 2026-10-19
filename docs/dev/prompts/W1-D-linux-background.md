You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md, and the SPEC.md sections named below. Then inspect the existing code named
here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w1-linux-bg`, branch `fix/linux-background-sessions`.

SPEC sections: §6, §12 ("sessions keep running in the background"). Read docs/dev/LINUX.md (from
Wave 0) first.

# W1-D — Linux: orchestration keeps running when the window closes

Architecture map says: on Linux, closing the window really quits the app, which stops rolling and the
scheduler unless the Host owns the sessions (`src/main/index.ts` window-all-closed / quit handling,
`App.tsx` close handling; Host driving in `src/host/driving.ts`, `driverOf`).

Build:
- Find out precisely, on this Linux machine, what keeps running after closing the window with an active
  Job: Host process? PTYs? dispatch loop (`driverOf` → host)? rolling? scheduler? Document it.
- Make the orchestration path survive window close on Linux: either ensure the Host is the driver for
  Jobs (preferred — it already exists for this) or add a tray / "keep running in background" behaviour
  consistent with how Windows/macOS already behave. Pick the smaller change that fits the existing
  design, explain why in the PR.
- Reopening the app must reattach to the same sessions with scrollback and must not start duplicate
  workers.
- Also check Wayland vs X11 (`src/main/ozone.ts`) and `.desktop`-launch PATH recovery (`loginPath.ts`) on
  this machine; fix only real breakage.
- Known issues found by Wave 0 (LINUX.md "Known issues"), which are yours:
  1. **A reattached Claude pane is blank until a resize.** After reopening, the tab reattaches to the same PTY
     and input works, but the TUI doesn't repaint until the pane is resized (toggling the sidebar fixes it).
     Fix it on attach (e.g. force a resize/SIGWINCH or replay the screen) so the pane shows the session at once.
  2. **Closing the window quits the app.** The close dialog ("Close and quit Astera … sessions keep
     running") quits main: the Host and its PTYs live on, but anything driven from main stops (rolling,
     scheduler, possibly the dispatch loop). This is the core of this prompt.
  3. The Host keeps an AppImage's `/tmp/.mount_astera*` mount alive after quit. That's by design; document it,
     don't fight it.
  Verified working already: the Host owns `claude` PTYs (parent is `out/main/host.js`), and reattach keeps the
  same process with unsent input intact.
- Tests where pure logic exists; otherwise a written manual verification script in LINUX.md.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
