import { describe, expect, it } from 'vitest'
import { inForkTurn } from './integrateGit'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

describe('inForkTurn', () => {
  it('runs forks of one repository one at a time, in arrival order, and hands on after a failure', async () => {
    const seen: string[] = []
    const step = (name: string, fail = false) => async (): Promise<string> => {
      seen.push(`${name}:start`)
      await tick()
      seen.push(`${name}:end`)
      if (fail) throw new Error(name)
      return name
    }
    const a = inForkTurn('C:\repo', step('a', true))
    const b = inForkTurn('C:\repo', step('b'))
    await expect(a).rejects.toThrow('a')
    await expect(b).resolves.toBe('b')
    expect(seen).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('lets forks of different repositories run at once', async () => {
    const seen: string[] = []
    const step = (name: string) => async (): Promise<void> => {
      seen.push(`${name}:start`)
      await tick()
      seen.push(`${name}:end`)
    }
    await Promise.all([inForkTurn('C:\one', step('one')), inForkTurn('C:\two', step('two'))])
    expect(seen.slice(0, 2).sort()).toEqual(['one:start', 'two:start'])
  })
})
