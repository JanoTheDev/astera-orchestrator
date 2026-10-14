// @astera-app/plugin-sdk: what an Astera plugin is written against (SDK + Plugin spec §15, plugin runtime design P10).
// A plugin's entry file exports `definePlugin({...})` as its default; Astera's launcher loads it, builds the context
// and calls `activate`. `ctx.astera` is a client from @astera-app/client, which the Host answers within the
// permissions the person granted the plugin. Plugins run trusted code on the person's machine: the permissions limit
// what a plugin asks Astera for, not what it can do (design P1).
import type { AsteraClient, AsteraEvent, EventGap } from '@astera-app/client'

/** The Plugin API this package is written for: the manifest's `astera.apiVersion` (spec §28). */
export const PLUGIN_API_VERSION = '1'

/** Lines to the plugin's log, which `astera plugins logs` reads. Anything the plugin prints goes there too. */
export interface PluginLog {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** Secrets the plugin keeps (spec §23): in Astera's store for this plugin alone, never shown to anyone, and redacted
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
  /** Aborted when Astera stops the plugin: disabled, removed, updated, or the Host leaving. */
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
   *  over again (after 1 s, doubling to 5 min, for an hour). It must settle within 30 s: a call past that is not
   *  stopped, and runs beside the event's next try. An event can come twice: `event.id` never repeats, so drop one
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
  readonly level: NotificationLevel
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
