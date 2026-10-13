# Changelog

`@astera-app/client` is versioned apart from the Astera app. [docs/sdk.md](https://github.com/parsingk/Astera/blob/main/docs/sdk.md)
is the guide.

## 0.1.0

The first release on npm. A client for the Astera Host on this machine, the one the desktop app, the `astera` command
and the MCP server reach:

- Projects, Jobs, Runs, Tasks, questions and completion as typed calls, and `call()` for any other Host command.
- `events.list`, `events.cursor` and `events.subscribe` on the Host's public event log, which needs Astera 1.4.12 or
  later.
- Stable error codes, request ids for calls that change something, and deadlines and cancellation on every call.
- ESM and CommonJS, with types, on Node 22 or later.
