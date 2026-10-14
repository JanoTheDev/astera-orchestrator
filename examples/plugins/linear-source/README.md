# Linear source

An Astera job source for [Linear](https://linear.app): it lists your team's open issues where you pick one to make a
Job from, in the app's Jobs view ("+ From a source"), with `astera sources`, or from an MCP client. A Job made from an
issue is to resolve it: Astera writes the Job's objective from the issue's title and description, quoted as data, and
the Job keeps the issue as its source, which the app links back to.
[The plugin guide](../../../docs/plugins.md#job-source-plugins) says how a job source is asked and what Astera checks.

## Install it

From a clone of the Astera repository, with the Astera app running:

```sh
astera plugins install --path examples/plugins/linear-source
```

That shows what the plugin is: a job source, which asks for no permission, since it only answers Astera. It installs
nothing yet. Approve it with `--yes`, or in the app under Settings, Plugins, Install from a folder.

The plugin waits until it has an API key. In Linear, open Settings, Security & access, Personal API keys, and create
one. It reads what your account can see. The key is a secret setting: give it on standard input so it stays out of
your shell history, and Astera keeps it out of the plugin's log.

```sh
printf %s "$LINEAR_API_KEY" | astera plugins configure --id astera-linear-source --stdin apiKey
```

In PowerShell:

```powershell
$env:LINEAR_API_KEY | astera plugins configure --id astera-linear-source --stdin apiKey
```

Name your team by its key to list only its issues (empty lists every team's):

```sh
astera plugins configure --id astera-linear-source --set teamKey=ENG
```

Then:

```sh
astera sources items --source astera-linear-source --query login
astera jobs create-from-source --source astera-linear-source --item ENG-123 --project <projectId> --coordinator-account <accountId>
```

## Settings

| Setting | What it does |
| --- | --- |
| `apiKey` | Your Linear personal API key. Secret, required. |
| `teamKey` | The team whose issues to list, by its key (`ENG` for `ENG-123`). Empty lists every team's. |
| `states` | The kinds of state to list, comma separated: `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`. `unstarted,started` unless you set it; empty lists every state. |
| `apiUrl` | Linear's GraphQL endpoint, `https://api.linear.app/graphql`. Change it only for a proxy or a test server. |

## What it answers

- A list: 30 issues a page, the most recently updated first, searched by title, each with its identifier, title, state,
  link and the start of its description. The next page continues from Linear's own cursor.
- An issue read whole: its description, and its team, state, priority, assignee and labels.
- A Job's context: the issue's title as what to do, its description as the evidence, `Linear ENG-123` as its label.

It retries nothing. When Linear refuses (a key that is not valid, an issue it does not know) the plugin throws Linear's
own sentence, and that is what the person reads where the list would be; `astera plugins logs --id
astera-linear-source` has the same line. It gives Linear 12 seconds, under the 15 Astera gives each call.
