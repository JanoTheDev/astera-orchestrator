You are working on my private Astera fork at /home/jonx/Desktop/Astera (Linux machine).
First read, in full: docs/orchestrator/CONTEXT.md (architecture map + rules you must follow),
docs/orchestrator/PLAN.md, docs/orchestrator/LINUX.md, and the SPEC.md sections named below. Then inspect
the existing code named here before writing anything. Extend existing code; do not build parallel systems.

Worktree + branch (rule 1 in CONTEXT.md): slug `w3-command`, branch `feat/orch-command-voice`.

SPEC sections: §8, §4 (lightweight coordinator), §12 (voice workspace commands).

# W3-B — Natural-language command layer + voice interface

Owner decision: speech engine = **local Whisper** (whisper.cpp preferred: single binary, Linux friendly,
no Python env). Implement `SpeechProvider` with a whisper.cpp provider that records push-to-talk audio
in the renderer (MediaRecorder), sends it to main, runs the configured whisper.cpp binary + model path
(settings; do not download models or binaries automatically — show setup instructions in settings and in
docs/orchestrator/USAGE.md). Audio never leaves the machine.

This is the "someone I talk to": the command bar is a conversation with the coordinator (cheap model), which
can answer status questions itself and, for "plan X", creates the plan and starts the W2-A planner.

Build:
- `src/core/intents/`: typed intent schema (switch workspace, show sessions, plan, approve/start, pause,
  resume, stop launching, send instruction to session, summarize since, list waiting/needs-input).
- Resolver: maps names ("Gameful Trading", "worker three", "the API worker") to exact project / plan /
  session IDs using orchestration data; ambiguous or not found → returns a clarification question with
  candidates; never guesses.
- Safety: classify intents; destructive ones (kill, cancel, archive+kill, merge, discard) always need an
  explicit UI confirm click — voice/text alone never executes them.
- Parser: the `coordinator` role model (W1-A) turns free text into intent JSON via a short one-shot CLI
  call or existing chat adapter — never the planner model. Deterministic fast-path for simple phrasings
  before calling a model.
- Executors call existing commands (`command.ts`, `sessions-send` via SessionDriver) — no new routing.
- UI: command bar (hotkey, via existing keybindings system) showing parsed intent, resolution, and
  confirm/clarify. `SpeechProvider` interface + push-to-talk wiring that feeds the same command bar.
- Tests: resolver ambiguity, destructive gating, intent → command mapping, send goes to exact session id.

## Done means
- Acceptance criteria above all demonstrably met.
- `npm run typecheck` clean; your new tests pass; full `npm test` run with results pasted in the PR (call
  out any pre-existing failures separately).
- Only files in your ownership row of PLAN.md changed (additive hunks elsewhere).
- Branch pushed, PR opened into `main` of JanoTheDev/astera-orchestrator. Do not merge.
- If something in the spec can't be done with existing APIs, stop and explain the limitation plus the
  smallest extension in the PR instead of inventing a parallel system.
