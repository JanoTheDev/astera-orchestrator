// T13: the hold on new starts, for the whole profile. While `<profile>/host/start-hold.json` exists, no new worker (an
// integration Task's merge worker included) and no new planner session starts: `worker-start` refuses (a 409 with
// `held: true`, which every placer reads as a wait, not a failure), the scheduler places nothing (schedule.ts
// `slotsToFill`), and `jobs-plan` starts no fresh planner. What already runs goes on: a worker's report, and the
// checks, the review and the merge of a finished Task, which are that Task finishing (a restart waits for them as it
// waits for a worker). A planner's own conversation resumed after a restart (`jobs-plan --resume`) is not a new start,
// and neither is the recovery of a lost worker, which never goes through `worker-start`.
//
// **Two holders.** `restart`: the Host sets it as it begins a restart (host/server.ts, the `restart` message) and the
// next Host lifts it once it has brought the handed-over sessions back (host/index.ts). `owner`: a person's own hold,
// which no Host lifts by itself. A restart never writes over an owner's hold: the next Host would then lift what the
// owner set.
//
// **A file beside the Host's own, not a field of orchestration.json, on purpose**: it outlives the Host that wrote it,
// which is the whole point of a restart's hold, and the next Host reads it before it has loaded any state.
//
// Node only (fs), so not for the renderer's project.
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { readFileRetrying, renameRetrying } from '../renameRetry'

export type StartHoldBy = 'restart' | 'owner'

export interface StartHold {
  by: StartHoldBy
  /** Why, in a person's words or the Host's. */
  reason: string
  /** ISO, when the hold was set. */
  at: string
}

/** The reason a restart's hold carries. */
export const RESTART_HOLD_REASON = 'the Astera Host is restarting'

export const startHoldFileIn = (profileDir: string, p: Pick<typeof path, 'join'> = path): string =>
  p.join(profileDir, 'host', 'start-hold.json')

const isBy = (v: unknown): v is StartHoldBy => v === 'restart' || v === 'owner'

/** What the file says. **A file that is there but does not read as a hold is still a hold**: its being there is the
 *  signal. It reads as the owner's, which no Host lifts by itself, so a hand edit gone wrong never lets work start
 *  behind a person who meant to stop it. */
export function parseStartHold(raw: string): StartHold {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return { by: 'owner', reason: 'start-hold.json is there but is not readable', at: '' }
  }
  const o = (typeof v === 'object' && v !== null ? v : {}) as Partial<Record<keyof StartHold, unknown>>
  return {
    by: isBy(o.by) ? o.by : 'owner',
    reason: typeof o.reason === 'string' ? o.reason : '',
    at: typeof o.at === 'string' ? o.at : ''
  }
}

/** The refusal a held start answers, in words a coordinator and a person can act on. */
export function startHoldMessage(h: StartHold): string {
  const since = h.at ? ` (since ${h.at})` : ''
  if (h.by === 'restart')
    return `new starts are on hold while the Astera Host restarts${since}; the next Host lifts the hold once it has resumed the sessions, so wait and start it again then`
  return `new starts are on hold${h.reason ? `: ${h.reason}` : ''}${since}; nothing new starts until the owner lifts the hold`
}

/** The hold to write when `wanted` is asked for over `current`; null leaves the file as it is. A restart keeps an
 *  owner's hold (the next Host lifts only a restart's). */
export function holdToWrite(current: StartHold | null, wanted: StartHold): StartHold | null {
  if (current?.by === 'owner' && wanted.by === 'restart') return null
  return wanted
}

/** Whether a lift by `by` removes `current`: any hold when `by` is absent, else only that holder's. */
export const mayLift = (current: StartHold | null, by?: StartHoldBy): boolean => current !== null && (by === undefined || current.by === by)

/** Whether a hold is on disk, answered at once: its being there is the hold (`parseStartHold`). For the paths that ask on
 *  every start and must not take an extra turn when nothing holds (a `stat` of a file in the profile). Never throws. */
export function startHeldNow(profileDir: string): boolean {
  try {
    return existsSync(startHoldFileIn(profileDir))
  } catch {
    return false
  }
}

/** The hold on disk, or null for none. A file that cannot be read for any reason but its absence is a hold (the
 *  owner's, `parseStartHold`): the safe side of a disk that answers oddly is starting nothing. Never rejects. */
export async function readStartHold(profileDir: string): Promise<StartHold | null> {
  let raw: string
  try {
    raw = await readFileRetrying(startHoldFileIn(profileDir))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    return { by: 'owner', reason: `start-hold.json could not be read (${code ?? String(err)})`, at: '' }
  }
  return parseStartHold(raw)
}

/** Sets `wanted` unless an owner's hold is already there (`holdToWrite`), through a temp file and a rename, so a
 *  reader never sees half a hold. Answers the hold in force afterwards. Rejects when the file cannot be written. */
export async function writeStartHold(profileDir: string, wanted: StartHold): Promise<StartHold> {
  const current = await readStartHold(profileDir)
  const next = holdToWrite(current, wanted)
  if (next === null) return current!
  const file = startHoldFileIn(profileDir)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(next), 'utf8')
  try {
    await renameRetrying(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  return next
}

/** Removes the hold when `mayLift` says so; true when one was removed. Never rejects: a hold that could not be removed
 *  is still in force, which is what false says. */
export async function liftStartHold(profileDir: string, by?: StartHoldBy): Promise<boolean> {
  const current = await readStartHold(profileDir)
  if (!mayLift(current, by)) return false
  try {
    await fs.rm(startHoldFileIn(profileDir))
    return true
  } catch {
    return false
  }
}
