// Runs the layout steps (layout.ts) against Discord one at a time, and records each id the bot creates in the store
// before the next step, so a crash part way never makes the same channel twice. syncLayout is the one entry point the
// Host calls (debounced there) after an activity event. Nothing here rejects: Discord being down or a missing
// permission is a log line, and the next sync tries again.
import type { OrchState } from '../../orchestration/state'
import { ChannelType, DiscordApiError, type DiscordRest } from '../rest'
import { desiredLayout, reconcile, type Op } from './layout'
import { readWorkspaceStore, slotId, withSlot, writeWorkspaceStore, type WorkspaceStore } from './store'

export type LayoutRest = Pick<
  DiscordRest,
  'guildChannels' | 'createChannel' | 'editChannel' | 'deleteChannel' | 'request'
>

export interface ApplyDeps {
  rest: LayoutRest
  /** Where the store is written after each step; none in a dry run. */
  storePath?: string
  log: (line: string) => void
}

const REASON = { reason: 'Astera plan workspace' }
/** The @everyone role's id is the guild's id. */
const SEND_MESSAGES = String(1 << 11)
/** Guilds whose channel cap was logged already: once per process, not on every sync. */
const cappedLogged = new Set<string>()

/** What a failure may say in a log: a DiscordApiError's status and code, never anything of the request. */
const detail = (e: unknown): string =>
  e instanceof DiscordApiError ? `status=${e.status}${e.code === null ? '' : ` code=${e.code}`}` : 'unexpected error'

/** Changing a channel's permission overwrites needs Manage Roles; every other step needs Manage Channels. */
const permissionOf = (op: Op): string =>
  op.op === 'archive' || (op.op === 'move' && op.unlock) ? 'Manage Roles' : 'Manage Channels'

async function run(op: Op, store: WorkspaceStore, rest: LayoutRest, log: ApplyDeps['log']): Promise<WorkspaceStore> {
  const guildId = store.guildId
  const idOf = (slot: Parameters<typeof slotId>[1]): string => {
    const id = slotId(store, slot)
    // the parent's own step failed: a 404 makes this step skip like any other gone channel
    if (id === null) throw new DiscordApiError(404, null)
    return id
  }
  switch (op.op) {
    case 'createCategory': {
      const ch = await rest.createChannel(guildId, { name: op.name, type: ChannelType.GUILD_CATEGORY }, REASON)
      return withSlot(store, op.slot, ch.id, op.name)
    }
    case 'createChannel': {
      const body = {
        name: op.name,
        type: ChannelType.GUILD_TEXT,
        parent_id: idOf(op.parent),
        ...(op.topic !== undefined ? { topic: op.topic } : {})
      }
      const ch = await rest.createChannel(guildId, body, REASON)
      return withSlot(store, op.slot, ch.id, op.name)
    }
    case 'remember':
      return withSlot(store, op.slot, op.id, op.name)
    case 'move':
      await rest.editChannel(op.id, { parent_id: idOf(op.parent) }, REASON)
      if (op.unlock) await rest.request('DELETE', `/channels/${op.id}/permissions/${guildId}`, undefined, REASON)
      return store
    case 'rename':
      await rest.editChannel(op.id, { name: op.name }, REASON)
      return withSlot(store, op.slot, op.id, op.name)
    case 'setTopic':
      await rest.editChannel(op.id, { topic: op.topic }, REASON)
      return store
    case 'deleteArchived':
      await rest.deleteChannel(op.id, REASON)
      return withSlot(store, op.slot, null)
    case 'archive': {
      const archiveId = idOf('cat:archive')
      // read-only first: a channel moved but left writable would never be locked by a later sync
      await rest.request(
        'PUT',
        `/channels/${op.id}/permissions/${guildId}`,
        { type: 0, allow: '0', deny: SEND_MESSAGES },
        REASON
      )
      await rest.editChannel(op.id, { parent_id: archiveId }, REASON)
      return store
    }
    case 'setPositions': {
      const ids = op.slots.flatMap((s) => slotId(store, s) ?? [])
      await rest.request(
        'PATCH',
        `/guilds/${guildId}/channels`,
        ids.map((id, position) => ({ id, position })),
        REASON
      )
      return store
    }
    case 'capped':
      if (!cappedLogged.has(guildId)) {
        cappedLogged.add(guildId)
        log("discord layout: the server is near Discord's 500-channel cap; no new plan channels are made")
      }
      return store
  }
}

/** Runs `ops` in order and answers the store as it stands after them. Stops at the first missing permission (one log
 *  line naming it) or other failure; skips a step whose channel is gone (404). Never rejects. */
export async function applyLayout(ops: Op[], storeIn: WorkspaceStore, deps: ApplyDeps): Promise<WorkspaceStore> {
  let store = storeIn
  for (const op of ops) {
    try {
      const next = await run(op, store, deps.rest, deps.log)
      if (next === store) continue
      store = next
      if (deps.storePath !== undefined)
        await writeWorkspaceStore(deps.storePath, store).catch((e: unknown) =>
          deps.log(`discord layout: could not save the workspace store (${e instanceof Error ? e.message : String(e)})`)
        )
    } catch (e) {
      const api = e instanceof DiscordApiError ? e : null
      if (api?.status === 404) continue
      if (api?.status === 403 || api?.code === 50013)
        deps.log(`discord layout: the bot lacks the ${permissionOf(op)} permission (${detail(e)}); layout sync stopped`)
      else deps.log(`discord layout: ${op.op} failed (${detail(e)}); layout sync stopped`)
      break
    }
  }
  return store
}

/** Reads the store, lists the guild's channels, reconciles and applies; answers the store after it, or null when
 *  Discord is not set up or the store could not be read. Never rejects. */
export async function syncLayout(a: {
  state: OrchState
  cfg: { guildId: string | null; plans: boolean }
  rest: LayoutRest
  storePath: string
  log: (line: string) => void
}): Promise<WorkspaceStore | null> {
  const guildId = a.cfg.guildId
  if (guildId === null) return null
  try {
    const store = await readWorkspaceStore(a.storePath, guildId)
    if (store === null) {
      a.log('discord layout: the workspace store could not be read; layout sync skipped')
      return null
    }
    let guild
    try {
      guild = await a.rest.guildChannels(guildId)
    } catch (e) {
      a.log(`discord layout: could not list the server's channels (${detail(e)})`)
      return store
    }
    const ops = reconcile(desiredLayout(a.state, { guildId, plans: a.cfg.plans }), guild, store)
    return await applyLayout(ops, store, {
      rest: a.rest,
      storePath: a.storePath,
      log: a.log
    })
  } catch {
    a.log('discord layout: sync failed unexpectedly')
    return null
  }
}
