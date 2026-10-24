// The Astera console (`console-ensure`): one chat session for every project, started by the Host in the profile dir
// with the brief (brief.ts) as its first prompt. Its id is kept in `<profile>/console.json`, so a Host restart finds the
// same session; one that ended is started again, and one that rolled to another account is followed to its new id.
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { renameRetrying } from '../renameRetry'
import type { HostSession, SessionCreate } from '../orchestration/command'
import { CONSOLE_BRIEF } from './brief'

export const CONSOLE_TITLE = 'Astera console'
export const CONSOLE_FILE = 'console.json'

export interface ConsoleIdStore {
  read(): Promise<string | null>
  write(id: string): Promise<void>
}

export interface ConsoleDeps {
  /** The folder the console starts in: the Astera profile dir. */
  cwd: string
  list(): Promise<HostSession[]>
  create(o: SessionCreate): Promise<HostSession>
  store: ConsoleIdStore
}

/** The console id in `<profileDir>/console.json`; a missing or unreadable file is no console yet. */
export function consoleIdStore(profileDir: string): ConsoleIdStore {
  const file = path.join(profileDir, CONSOLE_FILE)
  return {
    read: async () => {
      try {
        const id = (JSON.parse(await fs.readFile(file, 'utf8')) as { sessionId?: unknown }).sessionId
        return typeof id === 'string' && id !== '' ? id : null
      } catch {
        return null
      }
    },
    write: async (id) => {
      const tmp = `${file}.${randomUUID()}.tmp`
      try {
        await fs.mkdir(profileDir, { recursive: true })
        await fs.writeFile(tmp, JSON.stringify({ sessionId: id }), { encoding: 'utf8', flag: 'wx' })
        await renameRetrying(tmp, file)
      } catch (err) {
        await fs.rm(tmp, { force: true }).catch(() => undefined)
        throw err
      }
    }
  }
}

/** The live session `id` is now: itself, or the end of the account rolls that replaced it. */
function liveFrom(rows: readonly HostSession[], id: string): HostSession | null {
  const seen = new Set<string>()
  let at: string | undefined = id
  while (at !== undefined && !seen.has(at)) {
    seen.add(at)
    const self = rows.find((r) => r.id === at)
    if (self?.alive) return self
    at = rows.find((r) => r.rolledFrom === at)?.id
  }
  return null
}

const inFlight = new Map<string, Promise<HostSession>>()

/** The console session, started when none is alive. Calls for one profile run one at a time, so two clicks start one. */
export function ensureConsole(d: ConsoleDeps): Promise<HostSession> {
  const prev = inFlight.get(d.cwd) ?? Promise.resolve(null)
  const next = prev.catch(() => null).then(() => ensureOnce(d))
  inFlight.set(d.cwd, next)
  void next.finally(() => {
    if (inFlight.get(d.cwd) === next) inFlight.delete(d.cwd)
  }).catch(() => undefined)
  return next
}

async function ensureOnce(d: ConsoleDeps): Promise<HostSession> {
  const stored = await d.store.read()
  if (stored !== null) {
    const live = liveFrom(await d.list(), stored)
    if (live) {
      if (live.id !== stored) await d.store.write(live.id)
      return live
    }
  }
  const created = await d.create({
    kind: 'chat',
    cwd: d.cwd,
    title: CONSOLE_TITLE,
    prompt: CONSOLE_BRIEF,
    rollAccountIds: [],
    unattended: 'hold'
  })
  await d.store.write(created.id)
  return created
}
