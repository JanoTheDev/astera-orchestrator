// @astera-app/plugin-sdk: what an Astera plugin is written against (SDK + Plugin spec §15, plugin runtime design P10).
// A plugin's entry file exports `definePlugin({...})` as its default; Astera's launcher loads it, builds the context
// and calls `activate`. `ctx.astera` is a client from @astera-app/client, which the Host answers within the
// permissions the person granted the plugin. Plugins run trusted code on the person's machine: the permissions limit
// what a plugin asks Astera for, not what it can do (design P1).
import type { AsteraClient } from '@astera-app/client'

/** The Plugin API this package is written for: the manifest's `astera.apiVersion` (spec §28). */
export const PLUGIN_API_VERSION = '1'

/** Lines to the plugin's log, which `astera plugins logs` reads. Anything the plugin prints goes there too. */
export interface PluginLog {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface PluginContext {
  /** A client of the Host, answered within the permissions this plugin was granted. */
  astera: AsteraClient
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
}

/** The plugin an entry file exports as its default. */
export function definePlugin<T extends PluginDefinition>(definition: T): T {
  return definition
}
