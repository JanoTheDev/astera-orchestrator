Astera quick reference. Run these from this session; no Host needed for help. If `astera` is not found, call $ASTERA_CLI (bash/zsh) or $env:ASTERA_CLI (PowerShell) instead. Pass --json for machine output; --spec, --body, --question, --result take - to read stdin.

Other sessions and plans for later (not your own Run):
```
astera sessions list --json                            # every agent session
astera sessions read --id <sessionId> --json           # read it BEFORE sending
astera sessions send --id <sessionId> --text <msg> --request-id <id> --json
astera jobs create --objective <text> --cwd <repo-root> --json    # plan only, runs nothing
astera tasks add --job <jobId> --account <accId> --title <t> --spec - --json    # spec on stdin
astera accounts list --json
astera skills list --json
astera skills install --json                           # put back a missing Astera skill
astera main-plan --json                                # the project plans, their open Tasks
astera requests show --request-id <id> --json          # did my lost call take effect?
```

Coordinator, inside your Run:
```
astera task-create --run <runId> --title <t> --spec - --account <accId> --deps [] --json   # --deps takes a JSON array of Task ids
astera tasks list --run <runId> --json                 # add --ready or --status <s>
astera worker-start --task <tskId> --agent claude --account <accId> --worktree new --name <name> --json
astera check --run <runId> --json                      # next batch of reports; --wait blocks
astera check --run <runId> --ack <deliveryId> --json   # ack it, or it replays
astera dispatch-show --task <tskId> --json             # a Task's Dispatch history
astera gate-create --task <tskId> --question - --options <a,b> --json
astera gate-resolve --id <gatId> --resolution <text> --json
```

Worker, to finish (exactly once; failure is --outcome failed):
```
astera send --type worker_done --task-id <tskId> --dispatch-id <dspId> --outcome succeeded --subject <line> --body - --files-modified <a,b> --json
astera ask --task-id <tskId> --dispatch-id <dspId> --question - --json    # blocks for an answer
```
Body on stdin: what you did, what you found, what is left.

Rules that bite:
- sessions send types into whatever the other session shows; read it first. Never send to your own $ASTERA_SESSION or to your own workers.
- Pass --cwd with the repo root on jobs create. Only a person starts a Job.
- Do not change a retried Task's account.
- astera <command> --help prints one command's flags.

Full guide: astera help (about 100 KB). One section: astera help <N>. This text: astera help --brief.
```
astera help --brief
astera help 4
```
Sections:
1 Six concepts
2 Eight Task states and their transitions
3 A supervision loop, end to end
4 CLI reference
5 The Delivery contract of check
6 Worker obligations
7 The four worker-show states and what to do
8 Cleanup after completion
9 Do not, summary
10 Environment variables
11 Convergence Runs
12 The public commands an agent uses
