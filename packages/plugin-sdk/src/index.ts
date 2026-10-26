// @astera-app/plugin-sdk: what an Astera plugin is written against.
// A plugin's entry file exports `definePlugin({...})` as its default; Astera's launcher loads it, builds the context
// and calls `activate`. `ctx.astera` is a client from @astera-app/client, which the Host answers within the
// permissions the person granted the plugin. Plugins run trusted code on the person's machine: the permissions limit
// what a plugin asks Astera for, not what it can do.
import type { AsteraClient, AsteraEvent, EventGap } from '@astera-app/client'

/** The Plugin API this package is written for: the manifest's `astera.apiVersion`. */
export const PLUGIN_API_VERSION = '1'

/** Lines to the plugin's log, which `astera plugins logs` reads. Anything the plugin prints goes there too. */
export interface PluginLog {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** Secrets the plugin keeps: in Astera's store for this plugin alone, never shown to anyone, and redacted
 *  from the plugin's log. Names are letters, digits, `_`, `-` and `.`, at most 73, not starting or ending with `.`, and
 *  `Token` is the same name as `token`; values are text of at most 65,536 characters. */
export interface PluginSecrets {
  get(name: string): Promise<string | undefined>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
}

export interface PluginContext {
  /** A client of the Host, answered within the permissions this plugin was granted. */
  astera: AsteraClient
  /** The settings a person set for this plugin (`astera plugins configure`), with the manifest's defaults, secret ones
   *  included. Read when the plugin starts; a change restarts it. */
  settings: Readonly<Record<string, string | number | boolean>>
  secrets: PluginSecrets
  /** This plugin as installed: its id (the package name), its version and its folder. */
  plugin: { id: string; version: string; dir: string }
  /** The permissions the person granted, a subset of those the manifest asks for. */
  permissions: readonly string[]
  log: PluginLog
  /** Aborted when Astera stops the plugin: disabled, removed, updated, or the Host leaving. In a handler (`onEvent`,
   *  `send`, `listItems`, `getItem`, `buildJobContext`, `runCheck`) it is that call's: it also aborts when Astera stops
   *  waiting for the call (30 seconds for an event or a notification, 15 for a job source, 30 minutes for a check). */
  signal: AbortSignal
}

export interface PluginDefinition {
  /** Called once the plugin is loaded. Astera counts the plugin as running when it resolves. */
  activate?(ctx: PluginContext): void | Promise<void>
  /** Called before the plugin is stopped, with a few seconds to finish. */
  deactivate?(): void | Promise<void>
  /** The `event` capability (`astera.capabilities: ["event"]`, with the `events.subscribe` permission): each of
   *  Astera's events, in order, one at a time, from where this plugin left off, once `activate` has resolved. A
   *  `{ type: 'gap' }` first means events were lost before the next one. Throw or reject to have the same event handed
   *  over again (after 1 s, doubling to 5 min, for an hour). It must settle within 30 s: past that the call's
   *  `ctx.signal` aborts, and a handler that does not stop runs beside the event's next try. An event can come twice: `event.id` never repeats, so drop one
   *  you have seen. A property rather than a method, so a handler that takes only `AsteraEvent` does not typecheck:
   *  it would throw on a gap. */
  onEvent?: (event: AsteraEvent | EventGap, ctx: PluginContext) => void | Promise<void>
}

/** The plugin an entry file exports as its default. */
export function definePlugin<T extends PluginDefinition>(definition: T): T {
  return definition
}

/** The kinds of notification Astera sends a `notification` plugin, most pressing first. A provider offers a setting
 *  for the ones it leaves out; Astera sends all of them. Astera's own copy of this list is checked against this one. */
export const NOTIFICATION_KINDS = [
  'question.created',
  'session.input_needed',
  'run.failed',
  'completion.exhausted',
  'session.limit_waiting',
  'run.completed',
  'session.account_switched'
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** How much it matters: `action` waits on the person, `error` failed, `warning` stopped for now, `info` went on. */
export type NotificationLevel = 'action' | 'error' | 'warning' | 'info'

/** Something worth telling a person, already worded by Astera in the language the app is set to: post `title` and
 *  `body` as they are. */
export interface AsteraNotification {
  /** The event's id: a notification can come twice, so drop one you have seen. */
  readonly id: string
  /** The event's type. A later Astera may send a kind this list does not name yet: post it by its title and body. */
  readonly kind: NotificationKind | (string & {})
  /** How much it matters. A later Astera may add a level: post it as the nearest one you know. */
  readonly level: NotificationLevel | (string & {})
  /** What it is about: a Job's objective, or a session's title. */
  readonly title: string
  /** One sentence. */
  readonly body: string
  readonly occurredAt: string
  /** The whole event, for its ids and detail. */
  readonly event: AsteraEvent
}

/** A plugin of the `notification` capability (`astera.capabilities: ["notification"]`, with the `events.subscribe`
 *  permission). */
export interface NotificationProvider extends PluginDefinition {
  /** Each notification, in order, one at a time, once `activate` has resolved. Throw or reject to have it sent again
   *  (after 1 s, doubling to 5 min, for an hour); it must settle within 30 s. A notification older than an hour when
   *  its turn comes is not sent. */
  send: (notification: AsteraNotification, ctx: PluginContext) => void | Promise<void>
}

/** The provider an entry file exports as its default. */
export function defineNotificationProvider<T extends NotificationProvider>(provider: T): T {
  return provider
}

/** What `listItems` is asked: the person's search, and the cursor of the page before when there is one. */
export interface JobSourceQuery {
  query?: string
  cursor?: string
}

/** One item of a job source: a ticket, an issue. Astera refuses an item whose `id` is not 1 to 200 characters with no
 *  control characters (it is your own, opaque id, `ENG-123` say), cuts `title` at 300 characters, `status` at 100 and
 *  `summary` at 1,000, and keeps `url` only when it is http or https. */
export interface JobSourceItem {
  id: string
  title: string
  status?: string
  url?: string
  summary?: string
}

/** A page of items: at most 100 are kept, and `nextCursor` (at most 2,000 characters) is handed back to `listItems`
 *  for the next page. No `nextCursor` means this is the last page. */
export interface JobSourcePage {
  items: JobSourceItem[]
  nextCursor?: string
}

/** One item read whole: `body` cut at 20,000 characters, and at most 50 `fields` of short text (100 characters a name,
 *  1,000 a value), shown beside it. */
export interface JobSourceItemDetail extends JobSourceItem {
  body?: string
  fields?: Record<string, string>
}

/** What a Job made from an item is to do. Astera writes the Job's objective itself: a first line naming
 *  `sourceLabel` (`Linear ENG-123`, at most 200 characters) and `sourceUrl`, then your `objective` (at most 20,000), each
 *  `evidence` entry under its label (at most 20 entries, 20,000 characters each and 100,000 in all) and the `metadata`
 *  (at most 50 pairs), quoted as data the Job's agent does not take orders from. The Job keeps the item as its source,
 *  and is named, in the app, the CLI and notifications, by the first line of your `objective` (at most 300 characters):
 *  start it with the item's title. */
export interface JobSourceContext {
  objective: string
  sourceLabel: string
  sourceUrl?: string
  evidence?: Array<{ label: string; content: string }>
  metadata?: Record<string, string>
}

/** A plugin of the `job-source` capability (`astera.capabilities: ["job-source"]`, with no permission): Astera asks it
 *  for items when a person, the `astera sources` commands or an MCP client looks for a ticket to make a Job from. Each
 *  call has 15 seconds. Throw or reject to say why there is no answer ("401 Unauthorized"): the person reads that
 *  sentence, and Astera tries nothing again. A plugin missing any of the three does not start. */
export interface JobSourceProvider extends PluginDefinition {
  /** A page of items, searched with `input.query`, from `input.cursor` on. */
  listItems: (input: JobSourceQuery, ctx: PluginContext) => JobSourcePage | Promise<JobSourcePage>
  /** One item read whole, by the id `listItems` gave it. Throw for an id you do not know. */
  getItem: (id: string, ctx: PluginContext) => JobSourceItemDetail | Promise<JobSourceItemDetail>
  /** What a Job made from the item is to do, by the id `listItems` gave it. */
  buildJobContext: (id: string, ctx: PluginContext) => JobSourceContext | Promise<JobSourceContext>
}

/** The provider an entry file exports as its default. */
export function defineJobSourceProvider<T extends JobSourceProvider>(provider: T): T {
  return provider
}

/** What a completion check is asked about: the Task and the folder its checks run in. `root` is the Task's worktree, or
 *  the project folder; `base` is the commit the Task's work started from and `head` the one its last attempt reached,
 *  when Astera recorded them, so a check can look at what the Task changed. `branch` is not sent by this Astera: a
 *  check that needs it asks git in `root`. A check configured per project reads the project's own files under `root`;
 *  the plugin's settings are the rest of its configuration. */
export interface CompletionCheckInput {
  projectId?: string
  jobId: string
  runId: string
  taskId: string
  task: { title: string }
  workspace: { root: string; base?: string; head?: string; branch?: string }
}

/** One finding. Astera keeps a `message` (required) of up to 1,000 characters, a `file` of up to 500, a `line` that is a
 *  positive integer and a `severity` that is one of the two, and drops what is not. */
export interface CompletionCheckDiagnostic {
  file?: string
  line?: number
  message: string
  severity?: 'error' | 'warning'
}

/** A check's answer. `passed` lets the Task's next check run. `failed` is the code's fault: the Task's repair request
 *  carries your summary, your first 20 findings as `file:line message` and your link, and the Task fails where its Job
 *  repairs nothing. `error` says the check could not be made (a service down, a missing token): Astera asks once more,
 *  then puts it to a person, and no repair is spent on it. `summary` is cut at 1,000 characters (the status word when
 *  there is none), `diagnostics` keep the first 20 (Astera counts the rest, and keeps none of a `passed` check's: give
 *  the whole report as `externalUrl`), and `externalUrl` is kept when it is http or https within 2,048. */
export interface CompletionCheckResult {
  status: 'passed' | 'failed' | 'error'
  summary?: string
  diagnostics?: CompletionCheckDiagnostic[]
  /** How many findings there are, when you send fewer: send the first 20 and the count, not thousands to be cut. */
  diagnosticsTotal?: number
  externalUrl?: string
}

/** A plugin of the `completion-check` capability (`astera.capabilities: ["completion-check"]`, with no permission):
 *  Astera asks it when a Task whose checks name `plugin:<its id>` is done, in the order the Task lists its checks. A
 *  call has 30 minutes. Throw or reject to say the check could not be made: it counts as `error`, with your message. A
 *  plugin missing `runCheck` does not start. */
export interface CompletionCheckProvider extends PluginDefinition {
  runCheck: (input: CompletionCheckInput, ctx: PluginContext) => CompletionCheckResult | Promise<CompletionCheckResult>
}

/** The provider an entry file exports as its default. */
export function defineCompletionCheckProvider<T extends CompletionCheckProvider>(provider: T): T {
  return provider
}
