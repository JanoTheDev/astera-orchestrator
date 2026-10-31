// No Astera process may give a child process a console window of its own (win32). Written for the Host
// first (the history below); the CLI and the Electron main process apply the same guard through
// `hideChildConsoleWindows` at the end of this file.
//
// **Why this exists, and why it did not before 1.3.20.** node-pty forks a helper on every ConPTY
// kill — `_getConsoleProcessList` in windowsPtyAgent.js, which enumerates the console's processes
// from a separate process because a process can only be attached to one console. It calls
// `child_process.fork(...)` with no options, so no `windowsHide`, and `fork` starts the child from
// `process.execPath`.
//
// Until 1.3.20 that `process.execPath` was `Astera.exe` — an executable linked for the Windows GUI
// subsystem, which is never given a console. The helper was silent (it also failed outright under
// ELECTRON_RUN_AS_NODE; see the `leave` comment in index.ts). From 1.3.20 the Host runs from a Node
// of its own, and `node.exe` is linked for the **console** subsystem: the Host itself is started
// DETACHED and so holds no console, so Windows hands the forked helper a brand-new one. That is a
// black window flashing up every time a person closes a session tab.
//
// The option belongs on that `fork` call, which is inside a dependency. Rather than reach into it,
// the Host states the rule for itself: nothing it starts gets a console window. The wrapper only
// adds a creation flag — it changes no argument, no stdio, and nothing about how a pty is created or
// torn down, because pty creation does not go through `child_process` at all (it is native, in
// conpty.node). The single caller today is node-pty's helper.
import type childProcess from 'node:child_process'
import type { ChildProcess, ForkOptions } from 'node:child_process'

/** `windowsHide` is missing from `ForkOptions` in @types/node, but `fork` honours it: node's own
 *  implementation spreads the options it was given into the `spawn` call it makes
 *  (`options = { ...options, shell: false }` then `spawn(options.execPath, args, options)`), and
 *  `spawn` is where `windowsHide` is read. The type is the gap, not the runtime. */
type ForkOptionsWithHide = ForkOptions & { windowsHide?: boolean }

/** The `node:child_process` module object, narrowed to the one function that is replaced. Injected
 *  rather than imported here so the behaviour is testable without forking anything. */
export interface ForkHolder {
  fork: typeof childProcess.fork
}

/**
 * Replaces `fork` with one that always passes `windowsHide: true`. Returns whether it did.
 *
 * A no-op off win32 — `windowsHide` is meaningless there, and leaving the real function in place
 * keeps the one platform this is for from being the only one running patched code.
 *
 * Idempotent by construction at the call site (it runs once, at Host startup), and deliberately not
 * guarded against double application: wrapping twice would still be correct, just pointless.
 */
export function hideForkedConsoleWindows(cp: ForkHolder, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return false
  // One cast, at the boundary: it merges `fork`'s two overloads into the single signature the wrapper
  // below is written against, and admits `windowsHide` — which `ForkOptions` omits but `fork` passes
  // through (see ForkOptionsWithHide).
  const real = cp.fork as (
    modulePath: string | URL,
    argsOrOptions?: readonly string[] | ForkOptionsWithHide,
    options?: ForkOptionsWithHide
  ) => ChildProcess
  const wrapped = (
    modulePath: string | URL,
    argsOrOptions?: readonly string[] | ForkOptionsWithHide,
    options?: ForkOptionsWithHide
  ): ChildProcess => {
    // `fork(path, options)` — the second argument is the options object, not an args array.
    if (argsOrOptions !== undefined && !Array.isArray(argsOrOptions)) {
      return real(modulePath, { ...(argsOrOptions as ForkOptionsWithHide), windowsHide: true })
    }
    return real(modulePath, argsOrOptions as readonly string[] | undefined, { ...options, windowsHide: true })
  }
  // `fork` is declared as two overloads; this covers both in one signature, which TypeScript cannot
  // see as the same type. The cast asserts exactly that, and both forms have a test.
  cp.fork = wrapped as typeof childProcess.fork
  return true
}

/** The one method every async child start ends in: `spawn`, `exec`, `execFile` and `fork` all build a `ChildProcess`
 *  and call its `spawn(options)` with the normalized options (`windowsHide` among them). Injected for the test. */
export interface ChildProcessProto {
  spawn(this: unknown, options: { windowsHide?: boolean } & Record<string, unknown>): unknown
}

/**
 * Makes every async child the Host starts windowless (win32), whatever its call site passed. The `fork` wrapper above
 * covers node-pty's helper; this covers the rest: a `spawn`, `exec` or `execFile` anywhere in the Host or the core code
 * it runs (git helpers, attribution, setup commands, tools) that forgot `windowsHide` gave the detached console-
 * subsystem Host a brand-new console window, which Windows puts on top of whatever the person is doing.
 *
 * Patched on the prototype rather than on the module's functions because a bundled `import { spawn }` may have bound
 * the function before this runs; every one of them still calls `ChildProcess.prototype.spawn`. Sync starts
 * (`spawnSync`, `execSync`, `execFileSync`) do not go through it; those keep their own `windowsHide`.
 */
export function hideAllChildConsoleWindows(
  proto: ChildProcessProto,
  platform: NodeJS.Platform,
  opts: { exceptDetached?: boolean } = {}
): boolean {
  if (platform !== 'win32') return false
  const real = proto.spawn
  proto.spawn = function (this: unknown, options) {
    if (options && typeof options === 'object' && !(opts.exceptDetached && options.detached === true)) options.windowsHide = true
    return real.call(this, options)
  }
  return true
}

/** The sync starters on the `node:child_process` module object. They do not reach `ChildProcess.prototype.spawn`, and
 *  `execSync` / `execFileSync` do not reach the exported `spawnSync` either (node calls its module-local binding), so
 *  each is replaced on its own. Injected for the test. */
export interface SyncStarters {
  spawnSync: typeof childProcess.spawnSync
  execSync: typeof childProcess.execSync
  execFileSync: typeof childProcess.execFileSync
}

type Opts = { windowsHide?: boolean; detached?: boolean } & Record<string, unknown>

/** `options` with `windowsHide: true`, unless it asks for `detached` and `exceptDetached` holds. */
function hidden(options: unknown, exceptDetached: boolean): Opts {
  const o = (options && typeof options === 'object' ? options : {}) as Opts
  return exceptDetached && o.detached === true ? o : { ...o, windowsHide: true }
}

/**
 * Makes every sync child start windowless (win32): `spawnSync`, `execSync` and `execFileSync`, whatever its call site
 * passed. Replaced on the module object, which is what the bundled main and CLI call through (`childProcess.spawnSync(…)`
 * in out/main). Returns whether it did; a no-op off win32.
 */
export function hideSyncChildConsoleWindows(cp: SyncStarters, platform: NodeJS.Platform, opts: { exceptDetached?: boolean } = {}): boolean {
  if (platform !== 'win32') return false
  const except = opts.exceptDetached === true
  // `spawnSync(file, args?, options?)` and `execFileSync(file, args?, options?)`: the second argument is the options
  // object when it is not an args array. Node reads a null or absent args as no arguments, so the hidden options can
  // always go third once the second is not an object.
  const fileStyle = <F extends (...a: never[]) => unknown>(real: F): F =>
    ((file: string, argsOrOptions?: unknown, options?: unknown) =>
      argsOrOptions !== null && typeof argsOrOptions === 'object' && !Array.isArray(argsOrOptions)
        ? (real as unknown as (...a: unknown[]) => unknown)(file, hidden(argsOrOptions, except))
        : (real as unknown as (...a: unknown[]) => unknown)(file, argsOrOptions, hidden(options, except))) as unknown as F
  cp.spawnSync = fileStyle(cp.spawnSync)
  cp.execFileSync = fileStyle(cp.execFileSync)
  const realExecSync = cp.execSync as unknown as (command: string, options?: unknown) => unknown
  cp.execSync = ((command: string, options?: unknown) => realExecSync(command, hidden(options, except))) as typeof childProcess.execSync
  return true
}

/**
 * The guard the `astera` CLI and the Electron main process apply first thing (win32): every child they start, async
 * or sync, gets `windowsHide`. Both are GUI-subsystem programs (Astera.exe), so a console program they start without
 * it is handed a brand-new, visible console whenever they hold none themselves. `fork` is covered by the prototype
 * patch: it ends in `ChildProcess.prototype.spawn` like the others.
 *
 * **Detached children are left as their call site wrote them.** A detached start is DETACHED_PROCESS on win32: a
 * console program started that way has no console at all, so `windowsHide` would add nothing for it. What it would
 * do is hide a GUI program's first window (`SW_HIDE`), and the GUI programs these two processes start are detached:
 * electron-updater runs the NSIS installer (`oneClick: false`, so it has a UI) with `detached: true`. The Host's guard
 * has no such exception because it starts no GUI program.
 *
 * **Children that share the caller's terminal keep working.** `windowsHide` asks Windows to hide a console window
 * that is *created* for the child. A child started with inherited stdio from a CLI that is attached to a terminal
 * (Astera.exe run as Node attaches to its parent's console; measured: such a child makes no conhost of its own)
 * shares that terminal's console, so nothing is created and nothing is hidden; libuv also leaves CREATE_NO_WINDOW off
 * whenever a stdio slot is inherited. Only a child that would have been given a new console is affected, and that
 * is exactly the window that popped up.
 */
export function hideChildConsoleWindows(
  cp: SyncStarters & { ChildProcess: { prototype: unknown } },
  platform: NodeJS.Platform
): boolean {
  if (platform !== 'win32') return false
  hideAllChildConsoleWindows(cp.ChildProcess.prototype as ChildProcessProto, platform, { exceptDetached: true })
  hideSyncChildConsoleWindows(cp, platform, { exceptDetached: true })
  return true
}
