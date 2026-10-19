// W9-K: one window per project, side by side (DESIGN.md §1a). Every window belongs to the one app process and the one
// Host: `app.requestSingleInstanceLock()` stays (index.ts says why), so "another instance" is another window here.
// Electron-free so the rules are testable: index.ts hands in the real BrowserWindow factory and the file it saves to.
import path from 'node:path'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isSamePath } from '../core/files/tree'

/** The slice of a BrowserWindow the set uses. */
export interface ProjectWindow {
  readonly id: number
  isDestroyed(): boolean
  isMinimized(): boolean
  isMaximized(): boolean
  restore(): void
  show(): void
  focus(): void
  setTitle(title: string): void
  getNormalBounds(): WindowBounds
  webContents: { send(channel: string, payload: unknown): void }
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Where a project's window was, restored the next time that project gets a window. */
export interface WindowPlace {
  bounds: WindowBounds
  maximized: boolean
}

/** `<profile>/windows.json`. `open` is the windows to bring back at launch, null for an All window; `places` is keyed by
 *  project id, `''` for All. */
export interface SavedWindows {
  open: (string | null)[]
  places: Record<string, WindowPlace>
}

/** What a renderer tells main about itself: its project, the name for the title, and the session ids it shows (null =
 *  every session, an All window). */
export interface WindowScope {
  projectId: string | null
  name?: string
  sessionIds: string[] | null
}

export interface ProjectRef {
  id: string
  name: string
  path: string
}

const keyOf = (projectId: string | null): string => projectId ?? ''

const isBounds = (v: unknown): v is WindowBounds =>
  !!v &&
  typeof v === 'object' &&
  ['x', 'y', 'width', 'height'].every((k) => Number.isFinite((v as Record<string, unknown>)[k]))

/** Reads windows.json; anything malformed reads as nothing saved. */
export function savedWindowsOf(raw: unknown): SavedWindows {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const open = Array.isArray(r.open) ? r.open.filter((x): x is string | null => x === null || typeof x === 'string') : []
  const places: Record<string, WindowPlace> = {}
  if (r.places && typeof r.places === 'object')
    for (const [k, p] of Object.entries(r.places as Record<string, unknown>)) {
      const b = (p as { bounds?: unknown } | null)?.bounds
      if (isBounds(b)) places[k] = { bounds: b, maximized: (p as { maximized?: unknown }).maximized === true }
    }
  return { open, places }
}

/** windows.json on disk. A write goes through a temp file and a rename, so a crash mid-write leaves the old file. */
export function windowsFileStore(file: string): { read: () => SavedWindows; write: (s: SavedWindows) => void } {
  return {
    read: () => {
      try {
        return savedWindowsOf(JSON.parse(readFileSync(file, 'utf8')))
      } catch {
        return savedWindowsOf(undefined)
      }
    },
    write: (s) => {
      writeFileSync(`${file}.tmp`, JSON.stringify(s))
      renameSync(`${file}.tmp`, file)
    }
  }
}

/** The windows to open at launch: the saved ones whose project still exists, each project once, and an All window when
 *  none is left. */
export function restoreList(saved: SavedWindows, projectIds: readonly string[]): (string | null)[] {
  const out: (string | null)[] = []
  for (const id of saved.open) {
    if (id !== null && (!projectIds.includes(id) || out.includes(id))) continue
    out.push(id)
  }
  return out.length > 0 ? out : [null]
}

/** `--project <name|path>` or `--project=<name|path>` from a launch's argv; null when absent. */
export function projectArgOf(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--project=')) return a.slice('--project='.length) || null
    if (a === '--project') return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
  }
  return null
}

/** `--new-window` (the desktop file's action): open an All window even when one exists. */
export const newWindowArgOf = (argv: readonly string[]): boolean => argv.includes('--new-window')

/** A `--project` value to a project id: an id, a name (case ignored), or a folder in or under a project (relative to
 *  the launch's working directory). Null when nothing matches. */
export function resolveProjectArg(arg: string, cwd: string, projects: readonly ProjectRef[]): string | null {
  const byId = projects.find((p) => p.id === arg)
  if (byId) return byId.id
  const byName = projects.find((p) => p.name.toLowerCase() === arg.toLowerCase())
  if (byName) return byName.id
  const abs = path.resolve(cwd, arg)
  const inside = (p: ProjectRef): boolean => {
    const rel = path.relative(p.path, abs)
    return isSamePath(p.path, abs) || (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel))
  }
  // The innermost project wins: a repo inside another project's folder is its own project.
  const containing = projects.filter(inside).sort((a, b) => b.path.length - a.path.length)[0]
  return containing?.id ?? null
}

export interface WindowSetDeps<W extends ProjectWindow> {
  /** Makes and loads a window for this project, at its saved place when there is one. */
  create: (projectId: string | null, place: WindowPlace | undefined) => W
  read: () => SavedWindows
  write: (s: SavedWindows) => void
}

export interface WindowSet<W extends ProjectWindow> {
  /** Focuses the window of this project if it has one, else makes one. An All window (null) is always new. */
  open: (projectId: string | null) => W
  /** Takes in a window made elsewhere (the start-up window) under this project. */
  adopt: (win: W, projectId: string | null) => void
  all: () => W[]
  /** One push to every window; each renderer filters by its own project (W6-F scope). */
  broadcast: (channel: string, payload: unknown) => void
  projectOf: (win: W) => string | null
  /** The renderer switched project or its tabs changed. Retitles the window and saves the open list. */
  setScope: (win: W, scope: WindowScope) => void
  noteFocus: (win: W) => void
  /** The window a notice about this session opens: the project window showing it, else an All window, else the last
   *  focused one. Null when there is no window. */
  forSession: (sessionId: string | undefined) => W | null
  lastFocused: () => W | null
  focus: (win: W) => void
  /** Called on a window's `close`, before it is gone: saves where it was. */
  closing: (win: W) => void
  /** Called on `closed`. `quitting` keeps it in the open list, and so does the last window closing: closing the last
   *  window is a quit (W1-D), and that window comes back next launch. Any other close forgets it. */
  closed: (win: W, quitting: boolean) => void
}

export function createWindowSet<W extends ProjectWindow>(deps: WindowSetDeps<W>): WindowSet<W> {
  const entries = new Map<W, WindowScope>()
  let focusOrder: W[] = []
  const live = (): W[] => [...entries.keys()].filter((w) => !w.isDestroyed())
  const save = (patch: Partial<SavedWindows>): void => {
    try {
      deps.write({ ...deps.read(), ...patch })
    } catch {
      /* a lost save costs only the next launch's layout */
    }
  }
  const saveOpen = (): void => save({ open: live().map((w) => entries.get(w)!.projectId) })
  const focus = (win: W): void => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  const lastFocused = (): W | null => focusOrder.find((w) => !w.isDestroyed() && entries.has(w)) ?? live()[0] ?? null
  const adopt = (win: W, projectId: string | null): void => {
    entries.set(win, { projectId, sessionIds: null })
    focusOrder = [win, ...focusOrder.filter((w) => w !== win)]
    saveOpen()
  }
  return {
    open: (projectId) => {
      const existing = projectId === null ? undefined : live().find((w) => entries.get(w)!.projectId === projectId)
      if (existing) {
        focus(existing)
        return existing
      }
      const win = deps.create(projectId, deps.read().places[keyOf(projectId)])
      adopt(win, projectId)
      return win
    },
    adopt,
    all: live,
    broadcast: (channel, payload) => {
      for (const w of live())
        try {
          w.webContents.send(channel, payload)
        } catch {
          /* one renderer's send failure must not cost the others theirs */
        }
    },
    projectOf: (win) => entries.get(win)?.projectId ?? null,
    setScope: (win, scope) => {
      if (!entries.has(win) || win.isDestroyed()) return
      const was = entries.get(win)!.projectId
      // "All projects" is a view, not a binding: the window stays bound to its last project, so a reload or the next
      // launch comes back to it instead of to All.
      const kept = scope.projectId === null && was !== null
      entries.set(win, kept ? { ...scope, projectId: was, ...(entries.get(win)!.name ? { name: entries.get(win)!.name } : {}) } : scope)
      const shown = entries.get(win)!
      win.setTitle(shown.projectId !== null && shown.name ? `${shown.name} — Astera` : 'Astera')
      if (was !== shown.projectId) saveOpen()
    },
    noteFocus: (win) => {
      focusOrder = [win, ...focusOrder.filter((w) => w !== win)]
    },
    forSession: (sessionId) => {
      const ws = live()
      if (sessionId) {
        const own = ws.find((w) => entries.get(w)!.projectId !== null && entries.get(w)!.sessionIds?.includes(sessionId))
        if (own) return own
        const all = focusOrder.find((w) => ws.includes(w) && entries.get(w)!.projectId === null)
        if (all) return all
      }
      return lastFocused()
    },
    lastFocused,
    focus,
    closing: (win) => {
      const e = entries.get(win)
      if (!e || win.isDestroyed()) return
      save({
        places: { ...deps.read().places, [keyOf(e.projectId)]: { bounds: win.getNormalBounds(), maximized: win.isMaximized() } }
      })
    },
    closed: (win, quitting) => {
      const others = [...entries.keys()].filter((w) => w !== win && !w.isDestroyed())
      entries.delete(win)
      if (!quitting && others.length > 0) saveOpen()
      focusOrder = focusOrder.filter((w) => w !== win)
    }
  }
}
