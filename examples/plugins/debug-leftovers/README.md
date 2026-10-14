# Debug leftovers

An Astera completion check that fails a Task whose changes add a debug leftover: a `console.log`, a `debugger`, a
`TODO` or a `FIXME`. Each one is a finding at its file and line, and the Task's worker is asked to take it out; the
recheck passes once it has. [The plugin guide](../../../docs/plugins.md#completion-check-plugins) says how a completion
check is asked and what Astera does with its answer.

## Install it

From a clone of the Astera repository, with the Astera app running:

```sh
astera plugins install --path examples/plugins/debug-leftovers
```

That shows what the plugin is: a completion check, which asks for no permission, since it only answers Astera. It
installs nothing yet. Approve it with `--yes`, or in the app under Settings, Plugins, Install from a folder.

## Use it

Installing it adds no check. Name it among a Task's checks, after the run configurations it should follow:

```sh
astera tasks add --job <jobId> --spec "Fix the login page" --account <accountId> --validate npm-test,plugin:astera-debug-leftovers
```

When the Task's worker says it is done, Astera runs `npm-test`, then asks this plugin. With leftovers the check fails
and, in a Job with `--convergence`, the worker is sent a repair request that names each one at its file and line.

## Settings

| Setting | What it does |
| --- | --- |
| `patterns` | The text that counts as a leftover, comma separated, matched as it is written (case counts). `console.log,debugger,TODO,FIXME` unless you set it; empty looks for those. |

```sh
astera plugins configure --id astera-debug-leftovers --set "patterns=console.log,debugger,print("
```

## What it answers

It runs git in the folder the Task's checks run in (its worktree, or the project folder) and reads:

- what the folder holds now against the commit the Task's work started from (`git diff`), only the lines the Task adds:
  a leftover from before the Task, or one it removes, is not the Task's. With no starting commit recorded, it reads
  what is not committed yet;
- each new file git does not ignore, read whole, unless it is binary or larger than 1 MB.

Then it answers one of:

- `passed`: "no debug leftovers in 3 changed files".
- `failed`: "2 debug leftovers in 1 file", with a finding for each line that holds a pattern (`src/app.js`, line 12,
  "adds console.log"). It names the first 100 and counts them all.
- `error`, when the check could not be made: git is not installed, the folder is not a repository, or the starting
  commit is not there. The summary is git's own sentence. Astera asks once more, then asks a person whether to try
  again, go on without this check, or fail the Task.
