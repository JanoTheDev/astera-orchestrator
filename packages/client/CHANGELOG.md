# Changelog

`@astera-app/client` is versioned apart from the Astera app. [docs/sdk.md](https://github.com/parsingk/Astera/blob/main/docs/sdk.md)
is the guide.

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
