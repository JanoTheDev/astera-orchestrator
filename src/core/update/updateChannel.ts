// The releases channel's track (stable | beta) and which update channel, if any, this build runs.
// The source channel (sourceUpdate.ts) has no track: it follows origin/main.
import type { UpdateChannel, UpdateDisabledReason, UpdateStatus } from '../types'

export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = 'stable'
export const isUpdateChannel = (v: unknown): v is UpdateChannel => v === 'stable' || v === 'beta'
/** app-settings.json is user-editable: anything but an explicit 'beta' reads as stable. */
export const updateChannelOf = (v: unknown): UpdateChannel => (v === 'beta' ? 'beta' : DEFAULT_UPDATE_CHANNEL)

/** What electron-updater is told for a track. Beta only allows prereleases: electron-builder's github provider writes
 *  latest*.yml for a beta version too, and the updater falls back to it, so `channel` stays unset (setting it would
 *  also turn on allowDowngrade). Stable is set explicitly because electron-updater turns prereleases on by itself
 *  when the running version is one — a person on a beta who picks stable gets the next stable release. */
export const updaterOptionsOf = (channel: UpdateChannel): { allowPrerelease: boolean } => ({
  allowPrerelease: channel === 'beta'
})

/** Mirrors the branch in main/index.ts: the releases updater wins over the source channel when a build has both. */
export function activeUpdateChannelOf(b: {
  packaged: boolean
  autoUpdate: boolean
  builtCommit: string
  sourceDir: string
}): 'releases' | 'source' | null {
  if (!b.packaged) return null
  if (b.autoUpdate) return 'releases'
  if (b.builtCommit && b.sourceDir) return 'source'
  return null
}

/** Why no channel runs: a dev run (`unpackaged`), or a packaged build made with neither ASTERA_AUTO_UPDATE=1 nor a
 *  git checkout (`notBuiltForUpdates`). A code, not text: the renderer words it. */
export const updateDisabledOf = (packaged: boolean): UpdateStatus & { reason: UpdateDisabledReason } => ({
  state: 'disabled',
  reason: packaged ? 'notBuiltForUpdates' : 'unpackaged'
})
/** Every update:* call the renderer makes. With no channel each answers UpdateDisabled instead of rejecting with
 *  "No handler registered". update:campaignState is not here: it has a real answer in every build. */
export const UPDATE_IPC_CHANNELS = [
  'update:status',
  'update:check',
  'update:download',
  'update:install',
  'update:justUpdated',
  'update:dismissCampaign'
] as const
