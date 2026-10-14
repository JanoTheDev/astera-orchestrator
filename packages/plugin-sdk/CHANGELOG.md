# Changelog

`@astera-app/plugin-sdk` is versioned apart from the Astera app. [docs/plugins.md](https://github.com/parsingk/Astera/blob/main/docs/plugins.md)
is the guide.

## 0.2.0

- `onEvent` on a plugin: the `event` capability, which hands the plugin each of Astera's events in order, from where
  it left off, and tries an event again when the handler throws. It needs Astera 1.4.14 or later, and
  `@astera-app/client` 0.2.0 or later, whose events include the session events.

## 0.1.0

The first release on npm: `definePlugin` and the types of the plugin context, for Plugin API 1, which Astera 1.4.12
and later run. `ctx.astera` is typed by `@astera-app/client`, which npm installs beside it.
