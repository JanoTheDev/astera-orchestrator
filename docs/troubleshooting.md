# Troubleshooting

Where to look first, then symptom, cause and fix. Terms are in [Concepts](concepts.md).

## Where to look

- **Profile folder.** `~/.config/astera` on Linux, `~/Library/Application Support/astera` on macOS and `%APPDATA%\astera`
  on Windows. A dev app (`npm run dev`) uses the same name with `-dev` added, for example `~/.config/astera-dev`.
- **`host/host.log`** in the profile folder: the background Host. **`rolling.log`**: account rolling.
- **`orch/activity.jsonl`**: the feed behind **Handled for you**, kept across restarts.
- **Bottom panel** (`Ctrl+J`): **Needs you** (everything waiting on you), **Activity**, **Output** and **Terminal**.
- **Status bar**: the Host state ("Background service offline"), account usage and the count of consoles that need you.
- **Host commands:**

  ```bash
  astera host status     # is a Host running, and on which profile
  astera host start      # start one if none is running
  astera host stop       # ask the running Host to retire
  ```

  `astera host stop` refuses (exit 6) while the Host still holds sessions or runs; stop that work first. Exit codes are
  in [CLI, Exit codes](cli.md#exit-codes). `astera host status` prints the profile it resolved, which shows whether
  `ASTERA_PROFILE_DIR` points where you think.
- **Bug report.** Attach the version (Settings, Info), your OS and the relevant log lines to the form in
  [Issues](https://github.com/JanoTheDev/astera-orchestrator/issues/new/choose).

## Symptoms

| Symptom | Cause | Fix |
|---|---|---|
| The app opens but nothing runs; the status bar says "Background service offline" | The Host is stopped | Run `astera host start` (a Host that is already running counts as success), or press the status-bar item when it offers a restart. Read `host/host.log` if it stops again |
| A worker waits forever | A Claude permission prompt is open; agents stop at every prompt by default | Open **Needs you**, press the card (it says "Answer in its console") and answer in the console. To stop prompts for every session, turn on Settings → Agents → "Run agents without permission checks" (off by default) |
| A plan will not start: it waits for approval | Approval is on | Press **Approve & execute** in the plan tab (or **Talk to planner** first). `astera jobs set --id <job> --auto-approve on` starts plans without asking |
| A plan will not start: "App-wide limit full (N of M workers …)" | The app-wide worker cap is reached | Raise Settings → Agents → "Max workers across all jobs" (at most 10), or wait for a worker to finish |
| A Task is "Paused: <account> at 93% …" | The account is at the usage guard | Wait for the time shown, add an account, or raise Settings → "Pause new workers at usage (%)" (default 90) |
| A Task keeps failing | A failed worker, check or review makes a retry one rung stronger; after 3 failures in a row there are no more retries, and after 5 review rounds it escalates | Answer the **Needs your decision** row in **Needs you**. A review that needs something code cannot give (a device, a service) opens a decision, not another repair |
| A Task shows "waits for A" or "Waits for … (same files …)" | Its dependency is unfinished, or **One Task at a time on the same files** is on | Wait, or turn the setting off (`astera projects set --id <project> --serial-files off`) |
| Delivery failed ("Not delivered: …") | The push or PR step was refused: the folder is on another branch or has uncommitted changes, the branch cannot fast-forward, a conflict, failed validation, or a rejected push | Fix the cause, then press **Retry delivery** in the plan tab. If you pushed the branch yourself press **It's already pushed**; to give up press **Dismiss** (nothing is pushed or undone). From a shell: `astera run-deliver --run <id> --force` |
| A `pr` plan made no pull request | The project has no remote | The feed names the branch; run `git merge <branch>` in the project folder |
| A worktree is left behind | A plan stopped or was deleted, or the tree is dirty or has unpushed commits | In Source Control open **Worktrees** and press **Clean up N** (it never forces), or use the worktree's **⋯ → Delete**. Worktrees under **Yours** are never removed automatically |
| An account reached its usage limit | The account's 5-hour or 7-day window is full | With more than one account, rolling resumes on the next one by itself. With one, the work waits for the reset shown in the status bar. Check `rolling.log`. Sign in another account under Settings → Accounts & usage → **+** |
| An account row says it is not logged in | The login expired | Press **Sign in** on the row |
| The dev app's second instance quits silently | Astera allows one instance per profile, and the second quits | Close the first instance (look for a leftover Astera process), then launch again |
| `astera: command not found` | The command is not installed or its folder is not on `PATH` | Settings → CLI → **Install the astera command**, run the `PATH` line it shows and open a new shell. Inside an Astera session, call `"$ASTERA_CLI"` |
| `npm install` fails building `node-pty` | The native toolchain is missing | Install Node ≥ 22.13, `python3`, `make` and `g++` (Debian/Ubuntu: `sudo apt install build-essential python3`) |
| A dev relaunch fails on the same DevTools port | The Host spawned by the previous dev app inherited the port | Use a new `--remoteDebuggingPort`, or end the Host with `astera host stop` |
| "No agent CLI installed" banner | Neither `claude` nor `codex` is on `PATH` | Press **Install** in the banner, or install one yourself |

## Still stuck

Check [Known limits](product/known-limits.md) and the [Linux notes](dev/LINUX.md), then use the bug report form above.
Remote Runtime errors (`RUNTIME_OFFLINE` and others) are in [Remote Runtime](remote-runtime.md#troubleshooting).
