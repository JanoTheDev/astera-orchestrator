# @astera-app/plugin-sdk

Write [Astera](https://github.com/parsingk/Astera) plugins. Not published yet.

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
permissions the person granted; install the client beside this package for its types.

Plugins run trusted code on the person's machine: a plugin can do anything they can, and its permissions limit only
what it asks Astera for.
