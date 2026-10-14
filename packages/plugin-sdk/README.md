# @astera-app/plugin-sdk

Write [Astera](https://github.com/parsingk/Astera) plugins.

The guide, with a quick start and a sample plugin: [docs/plugins.md](https://github.com/parsingk/Astera/blob/main/docs/plugins.md).

```bash
npm install @astera-app/plugin-sdk
```

npm installs `@astera-app/client` beside it, whose types `ctx.astera` has. The example below imports `definePlugin`
when the plugin runs, so the package is a dependency; a plugin that imports only its types keeps it in
`devDependencies`, as [the guide](https://github.com/parsingk/Astera/blob/main/docs/plugins.md#typescript-and-bundling)
shows.

```ts
import { definePlugin } from '@astera-app/plugin-sdk'

export default definePlugin({
  async activate(ctx) {
    const { items } = await ctx.astera.projects.list()
    ctx.log.info(`${items.length} projects`)
  }
})
```

A plugin is a folder with a `package.json` whose `astera` field names its entry file, the Plugin API it is written for
(`"1"`) and the permissions it asks for. `ctx.astera` is a client from `@astera-app/client`, answered within the
permissions the person granted. A plugin that names the `event` capability gets each of Astera's events, in order, in
its `onEvent` ([event plugins](https://github.com/parsingk/Astera/blob/main/docs/plugins.md#event-plugins)), and one
made with `defineNotificationProvider` gets each notification, worded for a person, in its `send`
([notification plugins](https://github.com/parsingk/Astera/blob/main/docs/plugins.md#notification-plugins)).

Plugins run trusted code on the person's machine: a plugin can do anything they can, and its permissions limit only
what it asks Astera for.
