# Changelog

`@astera-app/client` is versioned apart from the Astera app. [docs/sdk.md](https://github.com/parsingk/Astera/blob/main/docs/sdk.md)
is the guide.

## Unreleased

The next release must be 0.5.0 or later: a `client-v0.4.0` tag already exists.

### Breaking

- The package's exports are now named, and the error internals are no longer exported: `codeForStatus`, `remoteCodeOf`,
  `exitCodeFor`, `ERROR_CODES`, `REMOTE_ERROR_CODES`, `PLUGIN_ERROR_CODES` and the `RemoteErrorCode` type. None was
  documented. What stays is `AsteraError`, `isAsteraError`, `EXIT_CODES`, `bodyCodeOf` and the `AsteraErrorCode` type;
  `EXIT_CODES[code]` replaces `exitCodeFor(code)`.
- New members of closed unions break an exhaustive `switch`: `TaskStatus` `'merging'`, `JobOutcome` and `RunOutcome`
  `'checking'` and `'blocked'`, `GateKind` `'review-needs-decision'` and `'review-ended'` (a review that ended without a
  report; answered `review-again` or `accept-as-done`). A `waits` result can now end in state `'blocked'`.

### Fixed

- `call('tasks-list', ...)` and `call('questions-list', ...)` with `limit` or `offset` answered `{}`; they now keep the
  shaped rows and the `total`, `offset` and `limit` counts. A worker's approval request now passes whole too.

### Added

- `Project.parentId`, `Job.priority`, `Job.title`, `Job.archivedAt`, `Question.source` (`'ask' | 'escalation'`) and
  `ReviewIssue.needs` (the `ReviewNeeds` type).
- `jobs.list({ archived: true })` also lists archived Jobs; `jobs.create` takes a `priority`.

## 0.3.0

- A Job's `source`: the job source and the item it was made from (`{ id, itemId, label, title?, url? }`, `title` the item's own, at most 300 characters), when Astera made it
  from a ticket, a Linear issue or a GitHub issue, say. It needs Astera 1.4.14 or later; an older one leaves it out.
- `call()` of `jobs-create-from-source` answers with the Job's public fields, as `jobs.create` does.
- Completion check plugins: a Task's check list can name `plugin:<pluginId>`. `CheckResult` (and the completion read
  model's `CompletionCheckDetail`) gains the status `error`, a plugin's check that could not be made, and the optional
  `summary`, `diagnostics` (`CheckDiagnostic`: `file?`, `line?`, `message`, `severity?`; at most 20, none for a
  passed check), `diagnosticsTotal` (how many findings the plugin gave, when more than `diagnostics` holds), `externalUrl`
  and `skipped` (a person let the round go on without it; its status is `not-run`). Events (`task.*` and
  `completion.*`) carry a check's `diagnosticsTotal` and not its findings: `tasks.get` and `completion.get` read them.
  A script that switches on four statuses meets a fifth. The question a check that could not be made opens has the new `GateKind` `check-unavailable`, answered with
  `retry`, `skip-check` or `mark-failed`. It needs Astera 1.4.14 or later; an older one has no plugin checks.
- The error code `PLUGIN_CAPABILITY_MISSING` (exit 6): a Task's check names a plugin that is not installed, does not
  offer completion checks, or is disabled. `bodyCodeOf` reads it, and the remote codes, from a refusal's body. It
  comes from Astera 1.4.14 or later.

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
