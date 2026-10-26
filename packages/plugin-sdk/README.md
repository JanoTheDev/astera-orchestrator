# @astera-app/plugin-sdk

Write [Astera](https://github.com/JanoTheDev/astera-orchestrator) plugins.

The guide, with a quick start and a sample plugin: [docs/plugins.md](https://github.com/JanoTheDev/astera-orchestrator/blob/main/docs/plugins.md).

```bash
npm install --save-dev @astera-app/plugin-sdk
```

npm installs `@astera-app/client` beside it, whose types `ctx.astera` has. Import the types only and export a plain
object, so the plugin needs nothing of the SDK when it runs: an install from npm leaves dev dependencies out, as
[the guide](https://github.com/JanoTheDev/astera-orchestrator/blob/main/docs/plugins.md#typescript-and-bundling) shows.

```ts
import type { PluginDefinition } from '@astera-app/plugin-sdk'

export default {
  async activate(ctx) {
    const { items } = await ctx.astera.projects.list()
    ctx.log.info(`${items.length} projects`)
  }
} satisfies PluginDefinition
```

`definePlugin` returns the object it is given, as sugar for the `satisfies`; it is code, so a plugin that calls it needs
the package as a dependency.

A plugin is a folder with a `package.json` whose `astera` field names its entry file, the Plugin API it is written for
(`"1"`) and the permissions it asks for. `ctx.astera` is a client from `@astera-app/client`, answered within the
permissions the person granted. A plugin that names the `event` capability gets each of Astera's events, in order, in
its `onEvent` ([event plugins](https://github.com/JanoTheDev/astera-orchestrator/blob/main/docs/plugins.md#event-plugins)), and one
that names the `notification` capability gets each notification, worded for a person, in its `send`
([notification plugins](https://github.com/JanoTheDev/astera-orchestrator/blob/main/docs/plugins.md#notification-plugins)), which
`defineNotificationProvider` types. One that names the `job-source` capability is asked for tickets a Job can be made
from, in its `listItems`, `getItem` and `buildJobContext`
([job source plugins](https://github.com/JanoTheDev/astera-orchestrator/blob/main/docs/plugins.md#job-source-plugins)), which
`defineJobSourceProvider` types. One that names the `completion-check` capability is asked whether a Task's work
passes, in its `runCheck`
([completion check plugins](https://github.com/JanoTheDev/astera-orchestrator/blob/main/docs/plugins.md#completion-check-plugins)),
which `defineCompletionCheckProvider` types.

Plugins run trusted code on the person's machine: a plugin can do anything they can, and its permissions limit only
what it asks Astera for.
