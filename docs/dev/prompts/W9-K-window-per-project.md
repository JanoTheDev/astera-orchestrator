You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md ("Wave 9 — Redesign", its contracts and the ownership table),
docs/dev/DESIGN.md (approved) and docs/guide.md, and open the mockup linked at the top of
DESIGN.md. W9-A is merged; use only its tokens and primitives. The other 9.2 tabs run in parallel; meet them only
through `components/shell/navigation.ts` and the PLAN contracts.

Worktree + branch: slug `w9-windows`, branch `feat/window-per-project`.

# W9-K — One window per project, side by side

Owner's words (2026-10-18): "make sure i can open multiple instances of the app if im running multiple projects
together". Build DESIGN.md "Windows" (§1a).

**Keep one process and one Host.** `app.requestSingleInstanceLock()` (`src/main/index.ts`) stays. Its comment
explains why: a second process re-creates the hook-events dir and orphans the first one's watcher. Two processes
would also count usage twice, fight over account rolling, and double the app-wide worker cap. So "another
instance" means **another window of the same app**.

1. **Windows** (`src/main/index.ts` window lifecycle, a new `src/main/windows.ts`):
   - Replace the single `mainWindow` with a set of windows. Each is bound to one project, or to All.
   - Every IPC push that went to `mainWindow` goes to every window. Each renderer filters by its project, through
     the W6-F scope it already has.
   - Notices and the tray open the window of the notice's project. If that project has no window, they open the
     last focused window, switched to that project.
2. **Ways to open one:**
   - The project switcher's "Open in new window" item.
   - `Ctrl+Shift+N` (rebindable).
   - The tray menu's project list.
   - A second launch, `astera-app --project <name|path>`, or the desktop-file action. It arrives in the
     `second-instance` handler, which opens or focuses that project's window instead of only focusing the main
     one.
   - Opening a project that already has a window focuses it.
3. **Per window state:**
   - Bounds, project and layout are saved per project and restored on launch.
   - The windows that were open at quit reopen.
   - Closing the last window keeps the W1-D background behaviour (the Host keeps running plans). Closing any other
     window just closes it.
4. **A session belongs to one window at a time.** Moving a tab between windows is not part of this (non-goal).
   - The same plan opened in two windows shows the same live state, because both read the Host.
   - Typing goes to whichever window has focus.
   - The owner hold (W9-H) is per session, not per window.

## Done means
- Tests: the window set (open, focus-existing, close-last keeps the Host), project binding from argv, restore list,
  broadcast reaches every window.
- Dev-app check by hand (alone, CONTEXT rule 7): open two projects in two windows, start a tiny plan in each,
  confirm each wall shows only its own tabs, a notice opens the right window, and quitting and relaunching restores
  both. Put screenshots in the PR.
- Typecheck, your tests, full suite via the flock line, results in the PR. USAGE.md "The workspace" gains
  "Several projects at once". Only your ownership row changed. PR into `main`. Do not merge.
