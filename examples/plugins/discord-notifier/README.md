# Discord notifier

An Astera plugin that posts Astera's notifications to a Discord channel: a question or a session waiting for you, a
failed or finished Run, a Task whose repairs ran out, a usage limit. [The plugin guide](../../../docs/plugins.md#notification-plugins)
says what each notification holds.

Each one is an embed: its title (the Job's objective, or the session's title), its sentence as Astera worded it in the
language the app is set to, a colour for how much it matters (blue waits on you, red failed, amber stopped for now,
green went on), its time, and its kind at the foot. Discord is told to ping nobody, so text a session or a question
holds, such as `@everyone`, stays text.

## Install it

From a clone of the Astera repository, with the Astera app running:

```sh
astera plugins install --path examples/plugins/discord-notifier
```

That shows what the plugin is and the one permission it asks for, `events.subscribe`: it is a notification plugin,
whose notifications come from Astera's events, and that is the permission the events need. It installs nothing yet.
Approve it with `--yes`, or in the app under Settings, Plugins, Install from a folder.

The plugin waits until it has a webhook URL. In Discord, open the channel's settings, then Integrations, Webhooks, and
copy a webhook's URL. The URL is a secret setting: give it on standard input so it stays out of your shell history,
and Astera keeps it out of the plugin's log.

```sh
printf %s "$DISCORD_WEBHOOK_URL" | astera plugins configure --id astera-discord-notifier --stdin webhookUrl
```

In PowerShell:

```powershell
$env:DISCORD_WEBHOOK_URL | astera plugins configure --id astera-discord-notifier --stdin webhookUrl
```

It leaves out account switches unless you say otherwise. To choose the kinds it leaves out, name them, separated by
commas (an empty value posts every kind):

```sh
astera plugins configure --id astera-discord-notifier --set skip=session.account_switched,run.completed
```

`astera plugins logs --id astera-discord-notifier` shows a line for each post, and why one failed.

## How it posts

- It posts the notifications after it first starts, once it has its webhook URL, and what happened while it was
  stopped when it runs again, as far back as Astera's event log keeps. A notification more than an hour old by then is
  not posted: Astera skips it, and the plugin's log counts the ones skipped.
- A post Discord refuses (a rate limit, say) is sent to it again by Astera: after 1 second, then 2, 4 and so on up to
  5 minutes, and given up after an hour with a line in the log. The notifications after it wait their turn.
- A notification can come twice (after a crash in the middle of one): its `id` never repeats.
