# Webhook notifier

An Astera plugin that posts what needs a person to a webhook: a failed Run, a Task whose repairs ran out, a question
for a person, and a completed Run unless you turn that off. [The plugin guide](../../../docs/plugins.md) walks through
how it is built.

It posts JSON, `{ "text": "...", "event": { ... } }`: `text` is one line for a person, which Slack's incoming
webhooks and Discord's (with `/slack` added to the webhook URL) show as the message, and `event` is the Astera event
as the [SDK](../../../docs/sdk.md#events) describes it, for a service of your own.

## Install it

From a clone of the Astera repository, with the Astera app running:

```sh
astera plugins install --path examples/plugins/webhook-notifier
```

That shows what the plugin is and the one permission it asks for, `events.subscribe` (to read Astera's events), and
installs nothing. Approve it with `--yes`, or in the app under Settings, Plugins, Install from a folder.

The plugin waits until it has a webhook URL. The URL is a secret setting: give it on standard input so it stays out of
your shell history, and Astera keeps it out of the plugin's log.

```sh
printf %s "$WEBHOOK_URL" | astera plugins configure --id astera-webhook-notifier --stdin webhookUrl
```

In PowerShell:

```powershell
$env:WEBHOOK_URL | astera plugins configure --id astera-webhook-notifier --stdin webhookUrl
```

To post only problems (no completed Runs):

```sh
astera plugins configure --id astera-webhook-notifier --set onlyProblems=true
```

`astera plugins logs --id astera-webhook-notifier` shows a line for each post, and why one failed.

## What it does not do

- It starts from the events of the moment it starts: what happened while it was stopped (the Host not running, the
  plugin disabled) is not posted. [notify-webhook.ts](../../sdk/notify-webhook.ts), the SDK's script, keeps a cursor in
  a file and posts those too.
- A post that fails is tried again three times, after 1, 2 and 4 seconds, then given up with a warning in the log.
- If Astera refuses its subscription (the permission was withheld, or the Host is too old for events), it ends, and
  Astera starts it again; after three such ends in a row the plugin shows as `failed`, and its log says why.
