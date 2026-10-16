# Changelog

`@astera-app/plugin-sdk` is versioned apart from the Astera app. [docs/plugins.md](https://github.com/parsingk/Astera/blob/main/docs/plugins.md)
is the guide.

## 0.2.0

- `onEvent` on a plugin: the `event` capability, which hands the plugin each of Astera's events in order, from where
  it left off, and tries an event again when the handler throws.
- `defineNotificationProvider` and its `send`: the `notification` capability, which hands the plugin each thing worth
  telling a person (a question, a session waiting, a failed or finished Run, a usage limit), worded by Astera in the
  person's language. `NOTIFICATION_KINDS` lists the kinds, for a provider's setting of the ones it leaves out.
- `defineJobSourceProvider` and its `listItems`, `getItem` and `buildJobContext`, with the types they answer
  (`JobSourceItem`, `JobSourcePage`, `JobSourceItemDetail`, `JobSourceContext`): the `job-source` capability, from
  which a person, the `astera sources` commands and MCP clients pick a ticket to make a Job from. The Job is named by
  the first line of the context's `objective`, so a provider starts it with the item's title.
- `defineCompletionCheckProvider` and its `runCheck`, with the types it is asked with and answers
  (`CompletionCheckInput`, `CompletionCheckResult`, `CompletionCheckDiagnostic`): the `completion-check` capability,
  which a Task names among its checks as `plugin:<id>`. Its `failed` goes to the Task's repair loop with its findings
  (Astera keeps the first 20; a check that found more sends 20 and its own `diagnosticsTotal`); its `error` is asked
  once more, then put to a person.
- In a handler (`onEvent`, `send`, `listItems`, `getItem`, `buildJobContext`, `runCheck`), `ctx.signal` is that call's:
  it also aborts when Astera stops waiting for the call, so a handler can stop the work it started.

All five need Astera 1.4.14 or later. The plugin SDK needs `@astera-app/client` 0.2.0 or later, whose events include the
session events.

## 0.1.0

The first release on npm: `definePlugin` and the types of the plugin context, for Plugin API 1, which Astera 1.4.12
and later run. `ctx.astera` is typed by `@astera-app/client`, which npm installs beside it.
