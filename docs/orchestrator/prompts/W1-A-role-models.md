You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, and the SPEC.md sections named below. Then inspect the existing code named
here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w1-role-models`, branch `feat/orch-role-models`.

SPEC sections: §4, §2.

# W1-A — Per-role model configuration

Today terminal sessions are spawned without `--model` (the pane types `/model`, see `src/core/types.ts`
around the `/model` handling), chat sessions pass `--model` (`src/core/chat/claudeProtocol.ts`).

Build:
- Roles: `coordinator` (lightweight NL assistant/status), `planner` (premium), `worker`, `reviewer`.
- App-level defaults in the existing app-settings store + optional per-Job override `Job.models?:
  Partial<Record<Role, string>>` (append to `interface Job` with a comment).
- One pure resolver `resolveRoleModel(appSettings, job, role, provider)` in new
  `src/core/orchestration/roleModels.ts` → model id or undefined (undefined = CLI default, current
  behaviour). Provider-aware: claude `--model <id>`, codex `-m <id>` (verify flags against the installed
  CLIs / existing chat adapters, don't guess).
- Pass it at spawn for orchestration sessions: coordinator (`startCoordinatorSession`), workers
  (`startWorkerWithChain` / `OrchCoordinator.startWorker`), reviewers (`reviewer.ts` / `exec/review.ts`).
  Record the model actually used on the `Dispatch` (append field) so UI can show "which model did this".
- Account rolling resume must keep the same model flag (check `src/core/rolling/claudeCoordinator.ts` /
  `codexCoordinator.ts` respawn args).
- Settings UI: new `OrchestratorModelsSettings.tsx` mounted in the existing settings dialog; free-text
  model id with sensible placeholders, empty = CLI default.
- Tests: resolver precedence (job override > app default > undefined), spawn args include flag, roll
  resume preserves it, Dispatch records model.

Owner decisions (2026-10-17):
- Owner has **Claude accounts only for now; Codex later**. Everything must work with Claude alone and
  pick up Codex automatically once a Codex account exists in `accounts.json`.
- **Mixed models by task difficulty.** Add `Task.difficulty?: 'light'|'standard'|'hard'` and optional
  `Task.model?`/`Task.provider?` (append). Resolution order for workers: Task.model > difficulty→model map
  (app setting, defaults: light=haiku, standard=sonnet, hard=opus) > Job override > app default > CLI
  default. Provider choice only among providers that currently have at least one account; if the
  requested provider has none, fall back to Claude and record why on the Dispatch.
- Defaults: planner=opus, reviewer=opus, coordinator=haiku, worker=via difficulty map. Use the CLI's
  model aliases (verify `claude --help` accepts `opus`/`sonnet`/`haiku`).
- **Reviewer fallback:** existing design requires a *different provider* for review (`reviewer.ts`). When
  only one provider has accounts, allow same-provider review using the `reviewer` model (must differ from
  the worker's model, else bump one tier) instead of skipping review. Test both paths.

W2-A (planner) will call `resolveRoleModel(..., 'planner', ...)` — keep that signature stable.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full `npm test` run with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
