# Using the orchestrator

## Command bar and voice (W3-B)

The command bar is a conversation with the **coordinator**. Open it with **Ctrl+Shift+K**
(rebind it in Settings → Shortcuts, action "Open the command bar").

Type a command and press Enter. The bar handles it in three steps:

1. **Parse.** Simple phrasings are read without a model (`core/intents/fastPath.ts`). Anything else goes to the
   `coordinator` role model (Settings → Orchestrator models, default `haiku`) in one read-only `claude -p` call. The
   planner model is never used for this. The call runs on your default signed-in Claude account (`defaultAccountIdOf`).
2. **Resolve.** Names like "Gameful Trading", "worker three" or "the API worker" are matched to exact plan and
   session ids from the workspace sidebar's data. If a name matches more than one thing, or nothing, the bar asks
   which one you mean and shows buttons. It never guesses.
3. **Run.** What runs, and how, depends on the kind of command:

| Kind | Commands | Runs |
|---|---|---|
| read | switch to a plan, show its sessions, summarize, list who is waiting, a plain answer | at once |
| act | plan X, send text to a session, resume | after you press **Run** (or Enter on an empty line) |
| confirm | approve and start, pause / stop launching, archive, delete, merge | only after a click in the app's confirmation dialog |

Voice and typed text never run a confirm-class command on their own.

Examples:

- `Switch to Gameful Trading` / `Show the Value List terminals`
- `What are workers waiting for?` / `Show every session needing my input`
- `Summarize the last 15 min` / `Show progress on Redis`
- `Plan the next Gameful refactor` creates the Job (the "+ New job" form's `run-create --auto`) and starts its
  planner (`jobs plan`). The project is the one named in the sentence, or else the open project.
- `Approve Console` / `Start executing the approved plan` sends `run-start` through the app after you confirm. A plan
  that does not hold together is refused, and the bar lists what is missing (`problems`).
- `send "run the tests" to the API worker` types the text into that one session (`sessions send`).

Limits:

- **Pause and stop-launching close sessions.** No command holds dispatch while leaving the workers open. A scheduled
  plan pauses with `run-pause`. Any other plan stops with `runs-stop`. Both close the plan's workers and coordinator,
  which is why they ask first. There is no per-worker pause: "pause worker three" asks which plan you mean.
- **Archive and delete** use the Jobs view's counts, so they only act on plans of the project the Jobs view has open.
- **Merge** opens the Run window, where the merge button and its own confirmation are.
- **Summaries** come from task states. W3-A's activity feed is not used here.

### Push-to-talk (local whisper.cpp)

Hold the microphone button in the bar while you talk, then release it. Or press **Ctrl+Shift+M** once to start and
again to send. The transcript goes into the bar like typed text. Read-class commands run at once. Everything else
waits for your click.

Audio never leaves the machine. The renderer records with MediaRecorder and converts the clip to 16 kHz mono WAV.
Main writes the WAV to a private temp folder (mode 700) and runs your whisper.cpp binary on it, then deletes the
clip. Nothing is downloaded automatically. Set it up once:

```bash
sudo apt install build-essential cmake git
git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
cmake -B build && cmake --build build -j --config Release
sh ./models/download-ggml-model.sh base.en      # or small / base for other languages
./build/bin/whisper-cli -m models/ggml-base.en.bin -f samples/jfk.wav   # check that it works
```

Then go to Settings → Voice commands and set both absolute paths:

- **whisper.cpp binary**: `/path/to/whisper.cpp/build/bin/whisper-cli`
- **Model file**: `/path/to/whisper.cpp/models/ggml-base.en.bin`

The app runs `whisper-cli -m <model> -f <clip.wav> -l auto -nt -np` with no shell, and reads stdout as the text. A
clip can be up to 2 minutes long.
