import { describe, it, expect } from 'vitest'
import { definePlugin, type PluginContext } from './index.js'

// That PLUGIN_API_VERSION is one the Host speaks is checked on the app's side (src/core/plugins/manifest.test.ts), so
// this package's checks never compile the app's sources.
describe('@astera-app/plugin-sdk', () => {
  it('definePlugin hands back the plugin it is given, typed', () => {
    const def = { activate: (_ctx: PluginContext) => {} }
    expect(definePlugin(def)).toBe(def)
  })
})
