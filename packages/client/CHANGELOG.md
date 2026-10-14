# Changelog

`@astera-app/client` is versioned apart from the Astera app. [docs/sdk.md](https://github.com/parsingk/Astera/blob/main/docs/sdk.md)
is the guide.

## 0.3.0

- A Job's `source`: the job source and the item it was made from (`{ id, itemId, label, title?, url? }`, `title` the item's own, at most 300 characters), when Astera made it
  from a ticket, a Linear issue or a GitHub issue, say. It needs Astera 1.4.14 or later; an older one leaves it out.
- `call()` of `jobs-create-from-source` answers with the Job's public fields, as `jobs.create` does.

## 0.2.0

- Three session events in the public event log: `session.input_needed` (a session waits on a person, for a permission
  or a question), `session.limit_waiting` (it stops at a usage limit) and `session.account_switched` (it goes on under
  another account). Each carries the session it is about, typed `EventSession`, and names it in the event's new
  `sessionId`.

The session events need Astera 1.4.13 or later: an older one refuses them in `types` with `INVALID_ARGUMENTS`. The rest
needs Astera 1.4.12 or later, as 0.1.0 did.

## 0.1.0

The first release on npm. A client for the Astera Host on this machine, the one the desktop app, the `astera` command
and the MCP server reach:

- Projects, Jobs, Runs, Tasks, questions and completion as typed calls, and `call()` for any other Host command.
- `events.list`, `events.cursor` and `events.subscribe` on the Host's public event log.
- Stable error codes, request ids for calls that change something, and deadlines and cancellation on every call.
- ESM and CommonJS, with types, on Node 22 or later.

It needs Astera 1.4.12 or later.
