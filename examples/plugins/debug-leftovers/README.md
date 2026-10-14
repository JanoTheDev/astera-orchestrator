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

It runs git 2.25 or later in the folder the Task's checks run in (its worktree, or the project folder) and reads
what the folder holds now against the commit the Task's work started from, only the lines the Task adds: a leftover from
before the Task, or one it removes, is not the Task's. With no starting commit recorded it reads what is not committed
yet, and in a repository with no commit at all, everything in it.

- A new file git does not ignore is read too, whole, unless it is binary or larger than 1 MB. A file moved or renamed
  without `git add` reads as a move, so what it held before is not counted.
- A symbolic link is read as git reads it, by the path it holds, not the file it points at.
- A submodule's own changes are not the Task's: it is read as the commit it stands at.
- In a folder inside a larger repository, only that folder's changes count, named from the folder.

It reads them with one `git diff`, using a copy of the repository's index, so your own index and staging are never
touched. Your git config (colours, prefixes, renames, context, an external diff tool) does not change what it finds.

Then it answers one of:

- `passed`: "no debug leftovers in 3 changed files".
- `failed`: "2 debug leftovers in 1 file", with a finding for each line that holds a pattern (`src/app.js`, line 12,
  "adds console.log"). It names the first 100 and counts them all.
- `error`, when the check could not be made: the folder is not a repository, or the starting commit is not there
  (the summary is git's own sentence, "git diff: fatal: bad object …"), or git is not installed or not on the PATH,
  or the folder is gone (each said in the plugin's own words). Astera asks once more, then asks a person whether to
  try again, go on without this check, or fail the Task.
