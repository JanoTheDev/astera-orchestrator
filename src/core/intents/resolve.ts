// W3-B: names as spoken → exact ids, from orchestration data only (SPEC §8: "ambiguous → ask, never guess").
//
// A name matches when every word of it is a word of the candidate's name ("api worker" ⊂ "API endpoints worker"),
// and better when the words are the same. Only the best rank counts: one match is the answer, several are a question
// with those candidates, none is a question listing what there is. Nothing falls back to "the first one".

export interface DirSession {
  sessionId: string
  role: 'planner' | 'coordinator' | 'worker'
  /** "Trading Worker 2" (workspaceTree.ts). */
  label: string
  taskTitle?: string
}

export interface DirPlan {
  jobId: string
  name: string
  projectId: string
  projectName: string
  projectPath: string
  scheduled: boolean
  /** Not started: a plan waiting for its approval (or a draft). */
  pendingStart: boolean
  /** The latest Run, absent before the plan has run. */
  runId?: string
  sessions: DirSession[]
}

export interface DirProject {
  id: string
  name: string
  path: string
}

/** Active plans only: an archived plan is not something a command acts on by name. */
export interface Directory {
  projects: DirProject[]
  plans: DirPlan[]
  currentProjectPath: string | null
  currentPlanId: string | null
}

/** A choice the person clicked in a clarification: re-resolves with that exact id. */
export interface Pins {
  planId?: string
  projectId?: string
  sessionId?: string
}

export interface Candidate {
  label: string
  pin: Pins
}

export type Miss = {
  ok: false
  what: 'plan' | 'project' | 'session'
  /** `unnamed`: nothing was named and nothing is open to stand for it. */
  why: 'ambiguous' | 'not-found' | 'unnamed'
  name?: string
  candidates: Candidate[]
}
export type Found<T> = { ok: true; value: T } | Miss

/** Shown at most, so a not-found question stays readable. */
const MAX_CANDIDATES = 8

const NUMBERS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5'
}
const FILLER = new Set(['the', 'a', 'an', 'this', 'that', 'my', 'plan', 'project', 'workspace', 'session', 'terminal', 'terminals', 'sessions'])

export function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w !== '' && !FILLER.has(w))
    .map((w) => NUMBERS[w] ?? w)
}

/** 2: the same words; 1: every query word is in the name; 0: no match. */
function rank(query: string[], names: readonly string[]): number {
  if (query.length === 0) return 0
  let best = 0
  for (const n of names) {
    const w = words(n)
    if (w.length === query.length && w.every((x, i) => x === query[i])) return 2
    const set = new Set(w)
    if (query.every((q) => set.has(q))) best = 1
  }
  return best
}

function best<T>(items: readonly T[], namesOf: (t: T) => string[], query: string[]): { rank: number; hits: T[] } {
  let top = 0
  let hits: T[] = []
  for (const it of items) {
    const r = rank(query, namesOf(it))
    if (r === 0 || r < top) continue
    if (r > top) {
      top = r
      hits = []
    }
    hits.push(it)
  }
  return { rank: top, hits }
}

const planLabel = (p: DirPlan): string => `${p.projectName} › ${p.name}`
const planCandidates = (plans: readonly DirPlan[]): Candidate[] =>
  plans.slice(0, MAX_CANDIDATES).map((p) => ({ label: planLabel(p), pin: { planId: p.jobId } }))
const planNames = (p: DirPlan): string[] => [p.name, `${p.projectName} ${p.name}`]

function currentProject(dir: Directory): DirProject | undefined {
  return dir.currentProjectPath === null ? undefined : dir.projects.find((p) => p.path === dir.currentProjectPath)
}

/** The plan a command acts on: the pinned one, the named one, or the open workspace's. A project name with one plan
 *  is that plan; with several it is a question. */
export function resolvePlan(dir: Directory, target: string | undefined, pins: Pins = {}): Found<DirPlan> {
  if (pins.planId !== undefined) {
    const p = dir.plans.find((x) => x.jobId === pins.planId)
    return p ? { ok: true, value: p } : { ok: false, what: 'plan', why: 'not-found', candidates: [] }
  }
  const scoped = pins.projectId !== undefined ? dir.plans.filter((p) => p.projectId === pins.projectId) : dir.plans
  const q = target === undefined ? [] : words(target)
  if (q.length === 0) {
    const open = dir.plans.find((p) => p.jobId === dir.currentPlanId)
    if (open && pins.projectId === undefined) return { ok: true, value: open }
    if (scoped.length === 1 && pins.projectId !== undefined) return { ok: true, value: scoped[0] }
    const here = currentProject(dir)
    const offer = pins.projectId === undefined && here ? scoped.filter((p) => p.projectId === here.id) : scoped
    return { ok: false, what: 'plan', why: 'unnamed', candidates: planCandidates(offer.length > 0 ? offer : scoped) }
  }
  const byPlan = best(scoped, planNames, q)
  const byProject = best(dir.projects, (p) => [p.name], q)
  const top = Math.max(byPlan.rank, byProject.rank)
  const hits = new Map<string, DirPlan>()
  if (byPlan.rank === top) for (const p of byPlan.hits) hits.set(p.jobId, p)
  if (byProject.rank === top)
    for (const pr of byProject.hits) for (const p of scoped) if (p.projectId === pr.id) hits.set(p.jobId, p)
  const found = [...hits.values()]
  if (found.length === 1) return { ok: true, value: found[0] }
  if (found.length > 1) return { ok: false, what: 'plan', why: 'ambiguous', name: target, candidates: planCandidates(found) }
  return { ok: false, what: 'plan', why: 'not-found', name: target, candidates: planCandidates(scoped) }
}

/** The project a new plan goes in: pinned, named, or else the one project the objective names ("plan the next
 *  Gameful refactor"), or else the open project. */
export function resolveProject(dir: Directory, target: string | undefined, objective: string, pins: Pins = {}): Found<DirProject> {
  const all = dir.projects.slice(0, MAX_CANDIDATES).map((p) => ({ label: p.name, pin: { projectId: p.id } }))
  if (pins.projectId !== undefined) {
    const p = dir.projects.find((x) => x.id === pins.projectId)
    return p ? { ok: true, value: p } : { ok: false, what: 'project', why: 'not-found', candidates: all }
  }
  const q = target === undefined ? [] : words(target)
  if (q.length > 0) {
    const { hits } = best(dir.projects, (p) => [p.name], q)
    if (hits.length === 1) return { ok: true, value: hits[0] }
    return hits.length > 1
      ? { ok: false, what: 'project', why: 'ambiguous', name: target, candidates: hits.map((p) => ({ label: p.name, pin: { projectId: p.id } })) }
      : { ok: false, what: 'project', why: 'not-found', name: target, candidates: all }
  }
  const said = new Set(words(objective))
  const named = dir.projects.filter((p) => {
    const w = words(p.name)
    return w.length > 0 && w.every((x) => said.has(x))
  })
  if (named.length === 1) return { ok: true, value: named[0] }
  if (named.length > 1)
    return { ok: false, what: 'project', why: 'ambiguous', candidates: named.map((p) => ({ label: p.name, pin: { projectId: p.id } })) }
  const here = currentProject(dir)
  return here ? { ok: true, value: here } : { ok: false, what: 'project', why: 'unnamed', candidates: all }
}

/** The plans a question is about: none named is every plan, a project is all of its plans, a plan is that plan. */
export function resolveScope(dir: Directory, target: string | undefined, pins: Pins = {}): Found<DirPlan[]> {
  if (pins.planId === undefined && pins.projectId !== undefined)
    return { ok: true, value: dir.plans.filter((p) => p.projectId === pins.projectId) }
  const q = target === undefined ? [] : words(target)
  if (pins.planId === undefined && q.length === 0) return { ok: true, value: dir.plans }
  if (pins.planId === undefined) {
    const byProject = best(dir.projects, (p) => [p.name], q)
    const byPlan = best(dir.plans, planNames, q)
    if (byProject.hits.length === 1 && byProject.rank >= byPlan.rank)
      return { ok: true, value: dir.plans.filter((p) => p.projectId === byProject.hits[0].id) }
  }
  const one = resolvePlan(dir, target, pins)
  return one.ok ? { ok: true, value: [one.value] } : one
}

export interface FoundSession {
  session: DirSession
  plan: DirPlan
}

/** One session by what it is called: "worker three", "the API worker", "Trading Coordinator". Searched in `plan`
 *  when the command named one, else everywhere; among equally good matches the open plan's win, and more than one
 *  left is a question. */
export function resolveSession(dir: Directory, name: string, plan: DirPlan | undefined, pins: Pins = {}): Found<FoundSession> {
  const pool = (plan ? [plan] : dir.plans).flatMap((p) => p.sessions.map((session) => ({ session, plan: p })))
  const label = (x: FoundSession): Candidate => ({
    label: `${x.session.label}${x.session.taskTitle ? ` — ${x.session.taskTitle}` : ''}`,
    pin: { sessionId: x.session.sessionId, planId: x.plan.jobId }
  })
  if (pins.sessionId !== undefined) {
    const hit = pool.find((x) => x.session.sessionId === pins.sessionId)
    return hit ? { ok: true, value: hit } : { ok: false, what: 'session', why: 'not-found', candidates: [] }
  }
  const { hits } = best(
    pool,
    (x) => [
      x.session.label,
      `${x.plan.projectName} ${x.session.label}`,
      ...(x.session.taskTitle ? [x.session.taskTitle, `${x.session.taskTitle} ${x.session.role}`] : [])
    ],
    words(name)
  )
  const open = hits.filter((x) => x.plan.jobId === dir.currentPlanId)
  const left = open.length > 0 ? open : hits
  if (left.length === 1) return { ok: true, value: left[0] }
  if (left.length > 1) return { ok: false, what: 'session', why: 'ambiguous', name, candidates: left.slice(0, MAX_CANDIDATES).map(label) }
  return { ok: false, what: 'session', why: 'not-found', name, candidates: pool.slice(0, MAX_CANDIDATES).map(label) }
}
