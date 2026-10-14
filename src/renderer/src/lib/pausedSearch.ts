// A search asked after a pause in typing (plugin Phase 4 J12, §3.2). A source's search can be rate limited (GitHub's,
// 30 a minute), and a person typing a word means one search, not one a letter: each call waits `ms` and replaces the
// one before it.

export interface PausedSearch {
  /** The text as it is now; it is asked for once `ms` passes with no newer text. */
  type(q: string): void
  /** Nothing waiting is asked for: the window is closing, or the source changed and was asked at once. */
  cancel(): void
}

export function createPause(ms: number, run: (q: string) => void): PausedSearch {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  return {
    type(q) {
      cancel()
      timer = setTimeout(() => {
        timer = undefined
        run(q)
      }, ms)
    },
    cancel
  }
}
