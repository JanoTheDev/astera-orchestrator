# Astera plugins

A plugin is a small Node program that Astera runs beside its Host, the process that owns your Jobs, Runs, Tasks and
questions. It starts when the Host starts and stops when the Host stops, and it reaches Astera through `ctx.astera`,
a client from [the SDK](sdk.md) that the Host answers within the permissions you granted the plugin. Use one to post
Astera's events somewhere, to react to a failed Run, or to connect Astera to a tool of your own, without keeping a
script running yourself.

Where it stands:

- A plugin is installed from a folder or from npm, and runs in the background: Astera calls its `activate` and lets it
  work. The kinds of plugin that Astera calls on for something (a source of Jobs, a completion check) do not run yet
  ([Not yet](#not-yet)).
- `@astera-app/plugin-sdk`, the package with the plugin's types, is **not on npm yet**. A plugin needs nothing from it
  to run: [the sample](../examples/plugins/webhook-notifier) is plain JavaScript and uses its types for the editor only.
- The Plugin API is version `1`.

## Plugins are trusted code

**Plugins run trusted code on this machine: a plugin can do anything you can, and its permissions limit only what it asks Astera for.**

A plugin is a process running as you. It can read and write your files, open network connections and start other
programs, whatever permissions it was granted. Its permissions decide what `ctx.astera` may ask the Host for, so an
honest plugin cannot reach further into Astera than you allowed; they are not a sandbox, and they do not stop a plugin
that means harm. Install plugins you trust, as you would any program, and read the code of one you are not sure of.
Astera shows this warning, with what the plugin asks for, before you approve an install: in the app every time, and
from `astera plugins install` without `--yes`.

## Quick start

A plugin is a folder with a `package.json`. Make a folder named `hello-astera` with this `package.json`:

```json
{
  "name": "hello-astera",
  "version": "0.1.0",
  "type": "module",
  "astera": {
    "apiVersion": "1",
    "entry": "index.js",
    "permissions": ["projects.read"]
  }
}
```

and this `index.js` beside it:

```js
export default {
  async activate(ctx) {
    const { items } = await ctx.astera.projects.list()
    ctx.log.info(`Astera has ${items.length} projects`)
  }
}
```

With the Astera app running and the `astera` command installed ([from Settings → CLI](cli.md#install)), install it
from a terminal of your own (on Windows, macOS and Linux alike) and read its log:

```sh
astera plugins install --path ./hello-astera --yes
astera plugins logs --id hello-astera
```

Without `--yes`, `install` shows what the plugin is and asks for, and installs nothing. The log shows Astera starting
it, what it wrote, and that it is running:

```text
2026-10-13T09:12:01.120Z [host] started pid 4120
2026-10-13T09:12:01.402Z [info] Astera has 2 projects
2026-10-13T09:12:01.405Z [host] running
```

`astera plugins list` shows it as `running`. The app's Settings → Plugins does the same: install from a folder,
approve, and open its log there. Run these commands in a terminal of your own: inside an Astera session
(`ASTERA_SESSION` is set) changing plugins is refused with exit 5, so an agent cannot install one on its own.

## The manifest

The manifest is `package.json`: npm's own fields, and an `astera` field for Astera.

| Field | |
|---|---|
| `name` | The plugin's id, which every command names it by: an npm package name, scoped or not (`@acme/astera-jira`). |
| `version` | A semver version. |
| `displayName` | Optional. What the app shows, up to 64 characters. |
| `description` | Optional. Shown when you install it: its first 500 characters. |
| `astera.apiVersion` | The Plugin API it is written for: `"1"`. |
| `astera.entry` | The file Astera starts, relative to the folder: an ES module (`.mjs`, or `.js` with `"type": "module"`) or CommonJS. |
| `astera.permissions` | What it asks Astera for ([Permissions](#permissions)). A person may grant fewer. |
| `astera.settingsSchema` | Optional. The settings a person gives it ([Settings and secrets](#settings-and-secrets)). |
| `astera.minAsteraVersion` | Optional. The oldest Astera it runs on; an older one installs it and does not run it. |
| `astera.capabilities` | Leave it out: a plugin that names a capability does not run yet ([Not yet](#not-yet)). |

The entry's default export is the plugin: an object with an `activate` and, if it needs one, a `deactivate`. A
CommonJS entry sets `module.exports` to it. `definePlugin` from the SDK returns the object it is given, so a plain
object is the same plugin.

## Permissions

Each permission opens these methods of `ctx.astera` to the plugin. A call without its permission is refused with
`PERMISSION_DENIED` (an `AsteraError`, exit code 5 in the SDK's terms), and a command the table does not list is
refused to every plugin, `call()` included. `call('requests-show', ...)` needs no permission: it reads only the plugin's
own request receipts.

| Permission | Lets the plugin call |
|---|---|
| `projects.read` | `projects.list`, `projects.get` |
| `jobs.read` | `jobs.list`, `jobs.get`, `jobs.wait` |
| `jobs.create` | `jobs.create` |
| `jobs.run` | `jobs.run` |
| `runs.read` | `runs.list`, `runs.get`, `runs.wait`, `runs.follow` |
| `runs.control` | `runs.stop`, `runs.resume` |
| `tasks.read` | `tasks.list`, `tasks.get` |
| `tasks.write` | `tasks.create` |
| `questions.read` | `questions.list`, `questions.get` |
| `questions.answer` | `questions.answer` |
| `completion.read` | `completion.get` |
| `events.subscribe` | `events.list`, `events.cursor`, `events.subscribe` |
| `github.read` | nothing yet |
| `github.write` | nothing yet |
| `how-it-works.read` | nothing yet |

`jobs.create` given a `projectId`, and `jobs.list` filtered by one, read that project first, so they need
`projects.read` too.
Ask for what the plugin needs and no more: a person sees the list before installing, and may uncheck any of it.
`ctx.permissions` is what was granted, so a plugin can leave out what it was not given rather than fail at it.

## The context

`activate(ctx)` gets everything the plugin has from Astera:

| | |
|---|---|
| `ctx.astera` | A client of the Host ([the SDK](sdk.md)), answered within the plugin's permissions. Astera closes it when the plugin stops. |
| `ctx.settings` | The settings a person gave it, with the manifest's defaults, secret ones included. Read once at the start: a change restarts the plugin. |
| `ctx.secrets` | `get`, `set` and `delete` on the plugin's own secret store ([Settings and secrets](#settings-and-secrets)). |
| `ctx.plugin` | Its `id`, `version` and `dir`, the installed copy it runs from. |
| `ctx.permissions` | The permissions granted, out of those it asked for. |
| `ctx.log` | `info`, `warn` and `error`, to the plugin's log ([Logs](#logs)). |
| `ctx.signal` | An `AbortSignal` that aborts when Astera stops the plugin. Pass it to whatever waits: a subscription, a `fetch`, a timer. |

## Lifecycle

**Start.** The Host starts every enabled plugin when it starts, and starts a plugin when it is installed or enabled.
It runs the entry in a process of its own and calls `activate(ctx)`, which must finish within 30 seconds;
the plugin counts as running when it has. Work that goes on (following events, a timer) is started from `activate`
and not awaited, as [the sample](../examples/plugins/webhook-notifier) does. The process keeps running after
`activate` returns, until Astera stops it.

**Stop.** Disabling, removing or installing a plugin again stops it, and the Host leaving stops every plugin.
Configuring a running plugin restarts it; a `failed` one stays stopped until `astera plugins enable` starts it. To
stop a plugin, Astera aborts `ctx.signal` and calls `deactivate()`, and the process ends as soon as `deactivate`
finishes, at once when there is none: cleanup that must finish (a last post, a file closed) goes inside `deactivate`,
not in a listener of the signal. It has 5 seconds to finish before Astera ends the plugin and the processes it
started. A plugin does not keep the Host running.

**Crash.** Any end Astera did not ask for is a crash: an uncaught exception, an unhandled rejection, `process.exit()`,
an `activate` that throws or does not finish in time. A plugin that crashes is started again after 1, then 2 seconds;
the third crash without 30 seconds of steady running marks it `failed`, and it stays stopped until
`astera plugins enable` starts it again or the Host restarts. A plugin that cannot go on (say its subscription was
refused) can end its own process with a failure to hand itself to this policy, as the sample does.

## Logs

`astera plugins logs --id <id>` prints the last lines of the plugin's log (`--lines <n>` for more), and the app opens it
from Settings → Plugins. It is a file, `<profile>/plugins/logs/<folder>.log`: `<profile>` is Astera's data folder,
which `astera host status` names, and the folder is the id with a scope's `/` written as `+`. It is kept to 2 MiB,
with one older file beside it. Each line has its time, and holds:

- what the plugin wrote with `ctx.log`, as `[info]`, `[warn]` or `[error]`;
- anything the plugin, or a child process that shares its output, printed on stdout or stderr, as it was printed;
- Astera's own lines, as `[host]`: started, running, exited, restarting, failed and why;
- the launcher's, as `[launcher]`: an entry that could not be loaded, or an `activate` that threw, with its stack.

**Secrets are hidden.** Every secret setting, and every secret the plugin read or set, is replaced by `[redacted]` in
the log and in the reason `plugins list` gives, each line of a secret that runs over several lines too; a value shorter
than 4 characters is not hidden, as it would take ordinary words out of every line. Only the value itself is found: a
token the plugin encodes, splits or puts in a URL of its own is not, so do not log secrets in any form.

## Settings and secrets

**Settings** are what a person gives the plugin: a URL, a project, a token. The manifest declares them in
`astera.settingsSchema`, a small part of JSON Schema:

```json
"settingsSchema": {
  "type": "object",
  "properties": {
    "baseUrl": { "type": "string", "title": "Jira URL", "description": "Such as https://acme.atlassian.net" },
    "token": { "type": "string", "title": "API token", "secret": true },
    "intervalMinutes": { "type": "integer", "title": "Check every", "default": 5, "enum": [1, 5, 15, 60] }
  },
  "required": ["baseUrl", "token"]
}
```

- A setting's type is `string`, `number`, `integer` or `boolean`.
- Its keywords are `type`, `title` (up to 64 characters), `description` (up to 500), `default`, `enum` (up to 50
  choices, not for a boolean) and `secret` (`true`, for a string). Any other keyword is refused, so a manifest that
  uses one does not install.
- A key is a letter, then letters, digits or `_`, at most 64 characters; two keys that differ only in case are
  refused. A manifest declares at most 50 settings.

A person sets them with `astera plugins configure --id <id> --set key=value`, or `--stdin key` for a secret so it stays
off the command line, or in the app's form for the plugin. A running plugin starts again with the new values. A plugin
missing a required setting does not start: it waits, and `plugins list` says which settings it needs.

A **secret setting** is kept apart from the others, in the plugin's own store under the profile: it is never shown
back (`plugins settings` says only whether it is set), no other plugin can read it through Astera, and it is hidden in
the log. It is a file under the profile, readable by any program running as you, as [any plugin is](#plugins-are-trusted-code).

**Secrets** the plugin keeps itself (a token it was given in exchange for another, say) go in the same store, through
`ctx.secrets`. A name is letters, digits, `_`, `-` and `.`, at most 73 characters, not starting or ending with `.`,
and `Token` is the same name as `token`. A value is text of at most 65,536 characters. A secret is hidden in the log
from the moment the plugin reads or sets it.

Removing a plugin deletes its settings and secrets. Astera keeps nothing else for a plugin: its installed copy is
replaced when it is installed again, so a plugin that must remember something across restarts keeps it in a folder of
its own.

## The Node a plugin runs on

A plugin runs on the Node its Host runs on, so the computer needs no Node install. On Windows that is a Node Astera
ships for its Host, `astera-host.exe`; on macOS and Linux it is Astera's own executable run as Node, from Electron 41.
Both are Node 24.15, with Node's own modules and globals (`fetch`, `WebSocket`, `AbortSignal.any` and the rest). The
plugin starts in its installed copy, with the Host's environment less Astera's own variables.

**`process.execPath` is not a `node` to count on.** On macOS and Linux it is Astera itself: a child started from it
without `ELECTRON_RUN_AS_NODE=1` in its environment starts as Astera rather than Node. On Windows it is the Host's
Node, where the variable does nothing. Set it either way, and `fork()` needs the same `env`. Do not count on a `node`
on the `PATH` either: the computer may have none.

```js
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))
const child = spawn(process.execPath, [worker], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit'
})
```

With `stdio: 'inherit'` the child's output goes to the plugin's log. Worker threads (`node:worker_threads`) need
nothing of this.

**Native addons.** An addon built on Node-API loads on every platform, as most prebuilt ones are. One built for a
particular Node version loads on Windows only if it was built for Node 24, and not on macOS or Linux, where Electron's
Node numbers its version differently: use Node-API. Astera runs no install script, so an addon that is compiled when
it is installed is never built: ship its prebuilt binaries for each platform in the package, or do without it.
`astera plugins doctor` warns about each `.node` file it finds.

## Packaging

### From a folder

`astera plugins install --path <folder>` copies the folder into `<profile>/plugins/installed`, so later edits to it
do nothing until you install it again. The copy holds plain files and folders:

- `node_modules` is copied as it is, so the dependencies `npm install` puts there (hoisted, npm's default) work;
  their dev tools are copied too, unless you install with `npm install --omit=dev` first.
- A link that stays inside the folder is followed and what it leads to is copied. A link that leads outside it,
  leads nowhere or loops stops the install. `npm install <a folder>` makes such a link: install a packed copy of that
  package (`npm pack` there, then `npm install` the `.tgz`), or bundle.
- Dependencies installed with pnpm's isolated layout (`node_modules/.pnpm`) or npm's linked strategy
  (`node_modules/.store`) find each other through links a copy cannot keep, so they stop the install: install them
  hoisted (`node-linker=hoisted`), or bundle.
- `.git` at the top is left out.

### From npm

Publish the package to npm (or a registry of your own) with its `astera` field, and install it by name:

```sh
astera plugins install --npm @acme/astera-jira
astera plugins install --npm "@acme/astera-jira@^1.2"
```

A range goes in quotes, as here: cmd.exe takes `^` for its escape character and drops it.

Astera fetches it with `npm pack` and unpacks it itself, refusing a package that holds a link, a path outside it, a
file name Windows cannot keep, two names that differ only in case, or more than 20,000 entries or 256 MiB. Its
`dependencies` and `optionalDependencies` are installed with
`npm install --omit=dev --ignore-scripts --no-bin-links --no-package-lock`, in a folder of Astera's, hoisted, and
moved into its `node_modules`; what the package bundles stays as it shipped. So `devDependencies` are not installed,
no install script runs, neither the package's nor a dependency's, no command links are made, and your
`package-lock.json` is not used: each install resolves the ranges afresh, within its `overrides`. Pin what must not
move, or bundle. Keep the package small with `files` in `package.json`. Astera runs your own npm when Node.js is installed, so your `.npmrc` (registries,
scopes, tokens) applies; without it, Astera fetches an npm of its own ([the `astera` command](cli.md#plugins) says
how).

### TypeScript, and bundling

Until the plugin SDK is on npm, build its types from a clone of this repository (`npm ci --ignore-scripts` and
`npm run build:packages`, as [the SDK guide](sdk.md#get-it) does), run `npm pack` in `packages/plugin-sdk` and in
`packages/client`, and install both `.tgz` files into your plugin as dev dependencies. Import the types only and
export a plain object, so the plugin needs nothing of the SDK when it runs:

```ts
import type { PluginContext, PluginDefinition } from '@astera-app/plugin-sdk'

async function watch(ctx: PluginContext): Promise<void> {
  for await (const event of ctx.astera.events.subscribe({ types: ['run.failed'], signal: ctx.signal })) {
    if (event.type === 'run.failed') ctx.log.warn(`Run ${event.payload.id} of job ${event.payload.jobId} failed`)
  }
}

export default {
  activate(ctx) {
    // Not awaited: activate must finish soon, and this runs until Astera stops the plugin
    watch(ctx).catch((e: unknown) => {
      if (ctx.signal.aborted) return
      ctx.log.error(`stopped: ${String(e)}`)
      // Once the line above has left: ctx.log writes to stderr, which a pipe may write later
      process.stderr.write('', () => process.exit(1))
    })
  }
} satisfies PluginDefinition
```

Compile it with `tsc` and point `astera.entry` at the output. A plugin with dependencies is often simplest bundled
into one file, which installs from a folder or from npm with no `node_modules` at all:

```sh
npx esbuild src/index.ts --bundle --platform=node --format=cjs --outfile=dist/index.cjs
```

Bundle to CommonJS, as here, and point `astera.entry` at `dist/index.cjs`. Many dependencies are CommonJS and
`require()` Node's modules, which an ES module bundle cannot do: it loads, then fails with
`Dynamic require of "events" is not supported`.

## Developing a plugin

Edit, install again, read the log:

```sh
astera plugins install --path . --yes
astera plugins logs --id <id>
astera plugins doctor --id <id>
```

Installing the same plugin again replaces its copy, asks for your approval again (`--yes` gives it), and starts the
new copy. `plugins doctor` checks what could keep it from running: the manifest, whether this Astera runs it, the
entry file, native addons, its settings, and how it last ran. It exits 1 when anything would.

Start from [the sample](../examples/plugins/webhook-notifier), a plugin that posts Astera's events to a webhook: plain
JavaScript with no dependency, typed against the SDK by JSDoc comments, with tests that run it in Astera's plugin
runtime.

## Troubleshooting

`astera plugins list` gives each plugin's status, and the reason when there is one.

**`incompatible`.** This Astera will not run it, and the reason says why: a Plugin API it does not speak, a
`minAsteraVersion` newer than this Astera, or a capability it does not run yet. Update Astera, or take the
capability out of the manifest.

**`stopped`, needs settings.** A required setting has no value. Set it with `astera plugins configure`.

**`failed`.** It kept crashing ([Lifecycle](#lifecycle)). `astera plugins logs` shows why: the `[launcher]`
and `[error]` lines, and the `[host]` lines saying how it ended. Fix it (its code, or its settings with
`astera plugins configure`), then run `astera plugins enable --id <id>`: configuring it alone does not start it again.
Installing it again starts it too.

**`<command> needs the <permission> permission, which plugin <id> was not granted` in its log.** That is the Host's
answer to a call the plugin made, refused with `PERMISSION_DENIED`: the person who installed it did not grant that
permission. Install it again and grant it.

**The install stops on a link, pnpm or `.store`.** See [From a folder](#from-a-folder).

**An npm install fails.** The answer carries npm's last lines, with registry tokens taken out. When Astera could not
fetch an npm of its own (a company network, a firewall or a proxy may block registry.npmjs.org), the answer says so:
install Node.js, or install from a folder. [The `astera` command](cli.md#plugins) has the details.

**A child process starts Astera** (on macOS or Linux). It was started from `process.execPath` without
`ELECTRON_RUN_AS_NODE=1` ([The Node a plugin runs on](#the-node-a-plugin-runs-on)).

## Not yet

- Plugins that Astera calls on for something: the `event`, `job-source`, `completion-check` and `notification`
  capabilities. A plugin that names one installs, and does not run until an Astera that runs that kind.
- `@astera-app/plugin-sdk` on npm.
- The `github` and `how-it-works` commands for plugins, which their permissions are already named for.
- A folder for each plugin's own data, and a development mode that reloads a plugin as you edit it.
