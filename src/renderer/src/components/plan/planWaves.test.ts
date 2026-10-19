import { describe, expect, it } from 'vitest'
import type { JobTask } from '../../../../core/types'
import { wavesOf } from './planBoard'
import { titlesLine, waveStatusOf } from './planWaves'

const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: `T-${id}`, status: 'pending', openGates: 0, ...over })

describe('waveStatusOf', () => {
  it('is empty with no Tasks and done when every wave is', () => {
    expect(waveStatusOf([], {})).toEqual({ kind: 'empty' })
    const done = [task('a', { status: 'completed' }), task('b', { status: 'completed' })]
    expect(waveStatusOf(wavesOf(done, [['a'], ['b']]), {})).toEqual({ kind: 'done', total: 2 })
  })

  it('says which wave runs and that the next opens when its unfinished dependencies finish', () => {
    const tasks = [task('a', { status: 'completed' }), task('b'), task('c'), task('d')]
    const s = waveStatusOf(wavesOf(tasks, [['a'], ['b', 'c'], ['d']]), { b: ['a'], c: ['a'], d: ['b'] })
    expect(s).toMatchObject({ kind: 'running', n: 2, total: 3, next: 3 })
    expect(s.kind === 'running' && s.waitingOn.map((tk) => tk.id)).toEqual(['b'])
  })

  it('falls back to the current wave without dependency data, and names it on the last wave', () => {
    const tasks = [task('a'), task('b', { status: 'completed' }), task('c')]
    const first = waveStatusOf(wavesOf(tasks, [['a', 'b'], ['c']]), {})
    expect(first.kind === 'running' && first.waitingOn.map((tk) => tk.id)).toEqual(['a'])
    const last = waveStatusOf(wavesOf([task('x', { status: 'completed' }), task('y')], [['x'], ['y']]), {})
    expect(last).toMatchObject({ kind: 'running', n: 2, total: 2, next: null })
    expect(last.kind === 'running' && last.waitingOn.map((tk) => tk.id)).toEqual(['y'])
  })
})

describe('titlesLine', () => {
  it('lists up to three titles, then +N', () => {
    expect(titlesLine([task('a'), task('b')])).toBe('T-a, T-b')
    expect(titlesLine(['a', 'b', 'c', 'd', 'e'].map((id) => task(id)))).toBe('T-a, T-b, T-c +2')
  })
})
