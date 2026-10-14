// The wording the Host hands notification plugins (plugin 3c final review M3): a Job titled from the state once it is in
// memory, not from the empty state before the load, and the language the app is set to at that moment.
import { describe, it, expect } from 'vitest'
import type { Lang } from '../core/i18n'
import type { AsteraEvent } from '../core/publicContract'
import { hostNotifier } from './pluginNotify'

const RUN = { id: 'run_1', jobId: 'job_1', ordinal: 1, progress: { done: 1, total: 1 } }
const completed = { id: 'ev_aaaaaaaaaaaa_1', type: 'run.completed', sequence: 1, occurredAt: 'T', jobId: 'job_1', payload: RUN } as unknown as AsteraEvent

function rig(langs: Lang[] = ['en']) {
  const calls: string[] = []
  let loaded = false
  let release: () => void = () => {}
  const ready = new Promise<void>((r) => (release = r))
  const notify = hostNotifier({
    lang: async () => {
      calls.push('lang')
      return langs.length > 1 ? langs.shift()! : langs[0]
    },
    orch: {
      ready: async () => {
        calls.push('ready')
        await ready
        loaded = true
      },
      state: () => ({ jobs: loaded ? [{ id: 'job_1', objective: 'Ship it' }] : [] })
    }
  })
  return { notify, calls, load: () => release() }
}

describe('hostNotifier', () => {
  it('titles a Job once the state is in memory, not from the empty state before the load', async () => {
    const r = rig()
    const pending = r.notify(completed)
    await new Promise((res) => setTimeout(res, 20))
    r.load()
    expect((await pending)?.title).toBe('Ship it')
  })

  it('words each notification in the language the app is set to at that moment', async () => {
    const r = rig(['en', 'ko'])
    r.load()
    expect((await r.notify(completed))?.body).toBe('Run 1 finished.')
    expect((await r.notify(completed))?.body).toBe('1번째 Run 이 끝났습니다.')
  })

  it('reads neither the state nor the language for an event that is no notification', async () => {
    const r = rig()
    expect(await r.notify({ ...completed, type: 'job.created' } as unknown as AsteraEvent)).toBeNull()
    expect(r.calls).toEqual([])
  })
})
