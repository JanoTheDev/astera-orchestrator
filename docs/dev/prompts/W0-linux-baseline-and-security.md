You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/dev/CONTEXT.md (architecture map + rules you must follow),
docs/dev/PLAN.md, and the SPEC.md sections named below. Then inspect the existing code named
here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w0-baseline`, branch `chore/linux-baseline-security`.

SPEC sections: §10. Also read docs/dev/SECURITY-AUDIT.md.

# Wave 0 — Linux baseline + security hardening (run ALONE, before any other prompt)

Goal: prove this repo builds, tests and runs on this Linux machine, and make the fork safe to run.

1. Prereqs: check `node -v` (≥ 22.13), `python3`, `make`, `g++`, `git`. If a system package is missing,
   tell me the exact `sudo apt install ...` line and stop — don't run sudo yourself.
2. `npm ci` (postinstall compiles node-pty against Electron; audit confirmed it is legit). Capture failures.
3. `npm run typecheck` and `npm test`. Triage every failure: Linux-specific (path case-sensitivity,
   `/tmp` vs realpath, `\` separators, shell assumptions, missing tools) → fix at the root, minimal diff.
   Genuinely flaky/unrelated → list them.
4. Security (from SECURITY-AUDIT.md):
   - Disable auto-update for this fork: electron-updater must never download upstream releases
     (`src/main/index.ts` autoUpdater setup, `src/main/updatePolicy.ts`, remote `policy.json` fetch,
     `electron-builder.yml` publish). Prefer a single build-time/flag switch over deleting code, so upstream
     merges stay easy. Update UI should say updates are manual.
   - Bump `electron` to ≥ 41.10.6 and `undici` to ≥ 7.30 (latest patch in same major where possible);
     re-run `npm ci`, typecheck, tests.
   - Confirm defaults: MCP HTTP off/local, remote runtime 127.0.0.1, bypassPermissions never default.
5. Run it: `npm run dev`. Verify on Linux: window opens, a plain terminal session spawns and accepts
   typing, a `claude` session spawns (if `claude` is installed), closing/reopening the app reattaches Host
   sessions. Then `npm run dist:linux` and launch the AppImage once (`chmod +x`; may need
   `--no-sandbox` only if chrome-sandbox perms fail — document, don't hardcode).
6. Write `docs/dev/LINUX.md`: prereqs, exact commands, what works, what doesn't, known issues
   with file:symbol references. This file is the Linux source of truth for later waves.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full suite run (`flock /tmp/astera-fullsuite.lock nice -n 10 npx vitest run --maxWorkers=2`, CONTEXT.md rule 4 — never bare `npm test`) with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
