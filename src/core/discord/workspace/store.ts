// The ids of the Discord categories and channels the bot created (<profile>/discord-workspace.json). Only what is
// named here is ever edited, moved or deleted by the layout sync: the owner's own channels are never touched.
import { writeThroughTmp } from '../../accounts/fileQueue'
import { keepDamaged, readStoreFile } from '../../storeFile'

export interface WorkspaceStore {
  guildId: string
  categories: {
    astera: string | null
    archive: string | null
    projects: Record<string, string>
  }
  channels: {
    control: string | null
    sessions: string | null
    plans: Record<string, string>
  }
  /** The name the bot last gave each of its channels, by channel id: a name the owner changed is renamed back only
   *  when the bot's own name for it changes (the plan was renamed), never on every sync. */
  names: Record<string, string>
  /** The pinned card message of each plan (jobId → message id), kept beside the layout so one file holds the workspace. */
  cards: Record<string, string>
}

/** One place in the layout the bot owns: a fixed category or channel, a project's category or a plan's channel. */
export type Slot =
  'cat:astera' | 'cat:archive' | `cat:project:${string}` | 'ch:control' | 'ch:sessions' | `ch:plan:${string}`

export const emptyWorkspaceStore = (guildId: string): WorkspaceStore => ({
  guildId,
  categories: { astera: null, archive: null, projects: {} },
  channels: { control: null, sessions: null, plans: {} },
  names: {},
  cards: {}
})

export function slotId(s: WorkspaceStore, slot: Slot): string | null {
  if (slot === 'cat:astera') return s.categories.astera
  if (slot === 'cat:archive') return s.categories.archive
  if (slot === 'ch:control') return s.channels.control
  if (slot === 'ch:sessions') return s.channels.sessions
  if (slot.startsWith('cat:project:')) return s.categories.projects[slot.slice('cat:project:'.length)] ?? null
  return s.channels.plans[slot.slice('ch:plan:'.length)] ?? null
}

const setKey = (m: Record<string, string>, key: string, id: string | null): Record<string, string> => {
  const next = { ...m }
  if (id === null) delete next[key]
  else next[key] = id
  return next
}

/** The store with `slot` holding `id` (null forgets it) and, when given, the name the bot gave it. Pure. */
export function withSlot(s: WorkspaceStore, slot: Slot, id: string | null, name?: string): WorkspaceStore {
  const old = slotId(s, slot)
  const names = { ...s.names }
  if (old !== null && old !== id) delete names[old]
  if (id !== null && name !== undefined) names[id] = name
  const categories = { ...s.categories }
  const channels = { ...s.channels }
  if (slot === 'cat:astera') categories.astera = id
  else if (slot === 'cat:archive') categories.archive = id
  else if (slot === 'ch:control') channels.control = id
  else if (slot === 'ch:sessions') channels.sessions = id
  else if (slot.startsWith('cat:project:'))
    categories.projects = setKey(categories.projects, slot.slice('cat:project:'.length), id)
  else channels.plans = setKey(channels.plans, slot.slice('ch:plan:'.length), id)
  return { ...s, categories, channels, names }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const idMap = (v: unknown): Record<string, string> =>
  v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {}

/** The store for `guildId`: empty when the file is missing, damaged (its bytes kept beside it) or written for another
 *  guild (the owner moved the bot). null when the file is there but could not be read: the caller must not write
 *  over ids it never saw, or the next sync would create every channel a second time. */
export async function readWorkspaceStore(file: string, guildId: string): Promise<WorkspaceStore | null> {
  const read = await readStoreFile(file)
  if (read.kind === 'unreadable') return null
  if (read.kind === 'missing') return emptyWorkspaceStore(guildId)
  let raw: Record<string, any>
  try {
    raw = JSON.parse(read.text)
    if (!raw || typeof raw !== 'object') throw new Error('not an object')
  } catch {
    await keepDamaged(file, read.text)
    return emptyWorkspaceStore(guildId)
  }
  if (raw.guildId !== guildId) return emptyWorkspaceStore(guildId)
  return {
    guildId,
    categories: {
      astera: str(raw.categories?.astera),
      archive: str(raw.categories?.archive),
      projects: idMap(raw.categories?.projects)
    },
    channels: {
      control: str(raw.channels?.control),
      sessions: str(raw.channels?.sessions),
      plans: idMap(raw.channels?.plans)
    },
    names: idMap(raw.names),
    cards: idMap(raw.cards)
  }
}

/** Writes the store atomically (temp file and a retried rename). */
export const writeWorkspaceStore = (file: string, s: WorkspaceStore): Promise<void> =>
  writeThroughTmp(file, `${JSON.stringify(s, null, 2)}\n`)
