# Webhook notifier

An Astera plugin that posts what needs a person to a webhook: a failed Run, a Task whose repairs ran out, a question
for a person, and a completed Run unless you turn that off. [The plugin guide](../../../docs/plugins.md) walks through
how it is built.

It posts JSON, `{ "text": "...", "event": { ... } }`: `text` is one line for a person, which Slack's incoming
webhooks and Discord's (with `/slack` added to the webhook URL) show as the message, and `event` is the Astera event
as the [SDK](../../../docs/sdk.md#events) describes it, for a service of your own. `text` has `&`, `<` and `>`
escaped, as Slack's message format asks, so a Task titled `<!channel>` does not ping a channel; `event` is as it
was.

## Install it

From a clone of the Astera repository, with the Astera app running:

```sh
astera plugins install --path examples/plugins/webhook-notifier
```

That shows what the plugin is and the one permission it asks for, `events.subscribe`: it is an event plugin, which
Astera hands each of its events, and that is the permission the events need. It installs nothing yet. Approve it with
`--yes`, or in the app under Settings, Plugins, Install from a folder.

The plugin waits until it has a webhook URL. The URL is a secret setting: give it on standard input so it stays out of
your shell history, and Astera keeps it out of the plugin's log.

```sh
printf %s "$WEBHOOK_URL" | astera plugins configure --id astera-webhook-notifier --stdin webhookUrl
```

In PowerShell:

```powershell
$env:WEBHOOK_URL | astera plugins configure --id astera-webhook-notifier --stdin webhookUrl
```

For a service of your own, give it a signing secret the same way (`--stdin signingSecret`). Each post then carries
`X-Astera-Signature: sha256=<hex>`, the HMAC-SHA256 of the request body under that secret: compute it over the body
as it arrived, before parsing it, and compare the two in constant time (`crypto.timingSafeEqual` in Node). A
signature says where a post came from, not that it is new: `event.id` never repeats, so drop one you have seen.

To post only problems (no completed Runs):

```sh
astera plugins configure --id astera-webhook-notifier --set onlyProblems=true
```

`astera plugins logs --id astera-webhook-notifier` shows a line for each post, and why one failed.

## How it posts

- It posts the events after it first starts, once it has its webhook URL, and what happened while it was stopped (the
  Host not running, the plugin disabled, or starting again after a crash) is posted when it runs again, as far back as
  Astera's event log keeps; when older events were lost, it posts a line saying so first.
- A post that fails is handed to it again by Astera: after 1 second, then 2, 4 and so on up to 5 minutes, and given
  up after an hour with a line in the log naming the event. The events after it wait their turn.
- A post the webhook would refuse again every time (a 4xx other than 408 and 429: deleted, forbidden, not found) is
  not tried again: the log says so, and the next event goes.
- A post can come twice (after a crash in the middle of one): `event.id` never repeats, so drop one you have seen.
