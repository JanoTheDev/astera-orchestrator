// The Host's only voice. It is spawned with `stdio: 'ignore'` so the app can exit without waiting on
// it (design §4), which leaves a file as the one place it can explain itself (design §9).
//
// Through the shared log writer (stage 3, task 3): a line is buffered and appended asynchronously, the
// size is tracked in memory rather than stat'ed per line, and a file past the cap is rotated to
// host.log.1. A line is on disk when the Host leaves (`leave` flushes, and so does the process's exit
// hook, which also covers an uncaught exception); only a SIGKILL can cost the last timer's worth.
import { logWriterFor } from '../core/log/logWriter'

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export interface HostLog {
  write(message: string): void
  /** Writes what is buffered, synchronously. Never throws. */
  close(): void
}

export function openHostLog(a: { path: string; maxBytes?: number }): HostLog {
  const w = logWriterFor(a.path, { maxBytes: a.maxBytes ?? DEFAULT_MAX_BYTES, ensureDir: true })
  return {
    write(message) {
      // Nowhere left to report a failure: the reporter is what failed. The writer swallows its own.
      try {
        w.write(`${new Date().toISOString()} ${message}\n`)
      } catch {
        /* never */
      }
    },
    close() {
      w.flushSync()
    }
  }
}

/** Final review C1, the belt: a promise rejection nobody handled is logged, and the Host keeps running.
 *  Node 24's default (`--unhandled-rejections=throw`) turns one into an uncaught exception, which ends
 *  node.exe and every session in it; a Host that loses one notice is far better than one that loses every
 *  terminal. This is not the fix for any rejection: each path still ends in its own catch (R3). The error
 *  name only, because a message can carry a token. Never throws. Returns the undo, for tests. */
export function logUnhandledRejections(
  target: { on(event: 'unhandledRejection', l: (reason: unknown) => void): unknown; off(event: 'unhandledRejection', l: (reason: unknown) => void): unknown },
  log: HostLog
): () => void {
  const listener = (reason: unknown): void => {
    try {
      const name = reason instanceof Error ? reason.name : typeof reason
      log.write(`unhandled rejection (${name}), kept running`)
    } catch {
      /* nowhere left to say it */
    }
  }
  target.on('unhandledRejection', listener)
  return () => {
    target.off('unhandledRejection', listener)
  }
}

/**
 * The Host's last word (2026-10-12): an exception nobody caught ends node.exe with its stack on a stderr nobody reads,
 * and a Host died that way with every session in it and left no line. It is logged by the error's name and the frame
 * it was thrown at (never the message, which can carry a token), and then the Host exits with 70: a process past an
 * uncaught exception is not safe to keep, and `astera runtime serve` starts a new one. Exits even when the log
 * throws. Synchronously, so the line is down before the exit.
 */
export function logUncaughtExceptions(
  target: { on(event: 'uncaughtException', l: (err: unknown) => void): unknown },
  log: HostLog,
  o: { code: number; exit?: (code: number) => void }
): void {
  const exit = o.exit ?? ((code: number) => process.exit(code))
  target.on('uncaughtException', (err: unknown) => {
    try {
      const name = err instanceof Error ? err.name : typeof err
      // The Host's own frames, up to three, innermost first: one inside Node (`node:internal`, `<anonymous>`) says
      // nothing about where in the Host it went wrong. A listener here stops Node printing the stack, so these frames
      // are the whole record (final review M6). A frame carries no message.
      const all = err instanceof Error ? (err.stack ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('at ')) : []
      const own = all.filter((l) => !l.includes('node:internal') && !l.includes('<anonymous>'))
      const frames = (own.length > 0 ? own : all).slice(0, 3)
      log.write(`fatal: uncaught exception (${name})${frames.length > 0 ? ` ${frames.join(' < ')}` : ''}; exiting`)
      log.close()
    } catch {
      /* nowhere left to say it */
    }
    exit(o.code)
  })
}
