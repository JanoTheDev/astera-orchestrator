import { describe, it, expect, vi } from 'vitest'
import { attachConsoleLinks, cachedResolver } from './terminalLinks'

describe('cachedResolver', () => {
  it('a hit is cached: the same target is resolved once', async () => {
    const resolve = vi.fn(async () => 'D:\\out\\a.png')
    const r = cachedResolver(resolve, () => 0)
    expect(await r('a.png')).toBe('D:\\out\\a.png')
    expect(await r('a.png')).toBe('D:\\out\\a.png')
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  // An agent prints the output path in its tool call before the file is written; the first hover
  // misses. A miss kept forever meant that path never became a link for the terminal's life.
  it('a miss is remembered only briefly, then asked again', async () => {
    let now = 0
    const resolve = vi.fn(async (): Promise<string | null> => null)
    const r = cachedResolver(resolve, () => now, 5000)
    expect(await r('a.png')).toBeNull()
    now = 4999
    expect(await r('a.png')).toBeNull()
    expect(resolve).toHaveBeenCalledTimes(1) // still within the window: the hover storm is absorbed
    resolve.mockResolvedValueOnce('D:\\out\\a.png')
    now = 5000
    expect(await r('a.png')).toBe('D:\\out\\a.png')
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('a rejection is a miss, with the same short memory', async () => {
    let now = 0
    const resolve = vi.fn(async (): Promise<string | null> => {
      throw new Error('ipc')
    })
    const r = cachedResolver(resolve, () => now, 5000)
    expect(await r('a.png')).toBeNull()
    now = 6000
    expect(await r('a.png')).toBeNull()
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('a request still in flight is shared, not repeated', async () => {
    let finish: (v: string | null) => void = () => {}
    const resolve = vi.fn(() => new Promise<string | null>((res) => (finish = res)))
    const r = cachedResolver(resolve, () => 0)
    const a = r('a.png')
    const b = r('a.png')
    finish('/out/a.png')
    expect(await a).toBe('/out/a.png')
    expect(await b).toBe('/out/a.png')
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})

// A path Claude Code cut at the right edge and went on with after its indentation (core/run/consoleLinks.ts
// joinCutLines) is one link, across the rows it takes, when the whole of it names a file.
describe('attachConsoleLinks across a cut path', () => {
  /** Rows as text, or as text marked soft-wrapped (a continuation the terminal itself made). */
  const fakeTerm = (lines: Array<string | { text: string; wrapped: true }>, cols: number) => {
    let provider: { provideLinks: (y: number, cb: (links: unknown) => void) => void } | null = null
    const line = (row: string | { text: string; wrapped: true }) => {
      const text = typeof row === 'string' ? row : row.text
      return {
      isWrapped: typeof row !== 'string',
      length: cols,
      translateToString: () => text.padEnd(cols),
      getCell: (x: number) => {
        const ch = text.padEnd(cols)[x]
        return ch === undefined ? undefined : { getWidth: () => 1, getChars: () => (ch === ' ' ? '' : ch) }
      }
      }
    }
    const term = {
      cols,
      buffer: { active: { getLine: (y: number) => (lines[y] === undefined ? undefined : line(lines[y])), getNullCell: () => ({}) } },
      registerLinkProvider: (p: typeof provider) => ((provider = p), { dispose: () => {} })
    }
    const links = (y: number) => new Promise<Array<{ text: string; range: unknown }> | undefined>((r) => provider!.provideLinks(y, r as never))
    return { term, links }
  }

  it('links the whole path from any row it is on, and not the pieces', async () => {
    const PATH = 'C:\\Users\\anipen\\AppData\\Roaming\\astera-dev\\preview\\shots\\app-226bd0e8.png'
    const cols = 30
    const f = fakeTerm(['  "' + PATH.slice(0, 27), '    ' + PATH.slice(27, 53), '    ' + PATH.slice(53) + '",'], cols)
    const resolved: string[] = []
    attachConsoleLinks(f.term as never, {
      onUrl: () => {},
      resolvePath: async (target) => (resolved.push(target), target === PATH ? PATH : null)
    })
    for (const y of [1, 2, 3]) {
      const got = await f.links(y)
      expect(got?.map((l) => [l.text, l.range]), String(y)).toEqual([[PATH, { start: { x: 4, y: 1 }, end: { x: 24, y: 3 } }]])
    }
    expect(resolved).toContain(PATH)
  })

  const attach = (f: ReturnType<typeof fakeTerm>, files: string[]) =>
    attachConsoleLinks(f.term as never, { onUrl: () => {}, resolvePath: async (target) => (files.includes(target) ? target : null) })
  const PATH = 'C:\\Users\\anipen\\AppData\\Roaming\\astera-dev\\preview\\shots\\app-226bd0e8.png'

  // Final review I1: xterm drops a row's links that another row's link overlaps, so a cut path on the rows below must
  // not be handed back for this row: its own link stays.
  it("keeps the row's own link when a cut path starts on the next row", async () => {
    const A = 'C:\\Users\\anipen\\x\\a.png'
    const f = fakeTerm(['  "' + A + '",', '  "' + PATH.slice(0, 26), '    ' + PATH.slice(26, 52), '    ' + PATH.slice(52) + '",'], 30)
    attach(f, [A, PATH])
    expect((await f.links(1))?.map((l) => l.text)).toEqual([A])
    expect((await f.links(3))?.map((l) => l.text)).toEqual([PATH])
  })

  // Final review I2: a link the first row names by itself is not lengthened by the next row's first word.
  it('does not lengthen a link the first row names by itself', async () => {
    const f = fakeTerm(['  see lib/app.py:125', '  4. next'], 20)
    attach(f, ['lib/app.py'])
    const got = await f.links(1)
    expect(got?.map((l) => l.text)).toEqual(['lib/app.py'])
    expect(got?.[0].range).toEqual({ start: { x: 7, y: 1 }, end: { x: 20, y: 1 } })
    expect(await f.links(2)).toBeUndefined()
  })

  it('still links a path the terminal wrapped itself, once, and a path on one row', async () => {
    const wrapped = fakeTerm(['  ' + PATH.slice(0, 28), { text: PATH.slice(28, 58), wrapped: true }, { text: PATH.slice(58), wrapped: true }], 30)
    attach(wrapped, [PATH])
    for (const y of [1, 2, 3]) expect((await wrapped.links(y))?.map((l) => l.text), String(y)).toEqual([PATH])
    const one = fakeTerm(['  open D:\\x\\a.png now'], 40)
    attach(one, ['D:\\x\\a.png'])
    expect((await one.links(1))?.map((l) => l.text)).toEqual(['D:\\x\\a.png'])
  })
})
