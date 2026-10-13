import { describe, it, expect, vi, afterEach } from 'vitest'
import { createDirLoadQueue, DIR_READ_CONCURRENCY, planBatchReload, planRefresh, createDelayedPending, ROW_SPINNER_DELAY_MS } from './dirReload'

/** 손으로 끝내는 load — 몇 개가 동시에 도는지, 어떤 순서로 불렸는지를 밖에서 본다 */
function manualLoad(): {
  load: (dir: string) => Promise<void>
  calls: string[]
  inFlight: Map<string, number>
  maxInFlight: Map<string, number>
  finish: (dir: string, fail?: boolean) => Promise<void>
} {
  const calls: string[] = []
  const inFlight = new Map<string, number>()
  const maxInFlight = new Map<string, number>()
  const resolvers = new Map<string, { ok: () => void; fail: (e: Error) => void }[]>()
  return {
    calls,
    inFlight,
    maxInFlight,
    load: (dir) => {
      calls.push(dir)
      const n = (inFlight.get(dir) ?? 0) + 1
      inFlight.set(dir, n)
      maxInFlight.set(dir, Math.max(maxInFlight.get(dir) ?? 0, n))
      return new Promise<void>((ok, fail) => {
        if (!resolvers.has(dir)) resolvers.set(dir, [])
        resolvers.get(dir)!.push({ ok, fail })
      }).finally(() => inFlight.set(dir, (inFlight.get(dir) ?? 1) - 1))
    },
    finish: async (dir, fail) => {
      const r = resolvers.get(dir)?.shift()
      if (fail) r?.fail(new Error('boom'))
      else r?.ok()
      // 완료 뒤의 이어 읽기까지 마이크로태스크를 흘린다
      for (let i = 0; i < 10; i++) await Promise.resolve()
    }
  }
}

describe('createDirLoadQueue — 같은 폴더를 겹쳐 읽지 않는다', () => {
  it('읽는 동안 들어온 요청은 끝난 뒤 한 번만 더 읽는다', async () => {
    const m = manualLoad()
    const q = createDirLoadQueue(m.load)
    q.request('/r/a')
    q.request('/r/a')
    q.request('/r/a')
    q.request('/r/a')
    expect(m.calls).toEqual(['/r/a'])
    await m.finish('/r/a')
    expect(m.calls).toEqual(['/r/a', '/r/a'])
    await m.finish('/r/a')
    expect(m.calls).toEqual(['/r/a', '/r/a'])
    expect(m.maxInFlight.get('/r/a')).toBe(1)
  })

  it('다른 폴더는 상한까지 서로 기다리지 않는다', () => {
    const m = manualLoad()
    const q = createDirLoadQueue(m.load)
    q.request('/r/a')
    q.request('/r/b')
    expect(m.calls).toEqual(['/r/a', '/r/b'])
  })

  it('읽기가 실패해도 다음 요청은 다시 읽는다 — 거절이 새지 않는다', async () => {
    const m = manualLoad()
    const onUnhandled = vi.fn()
    process.on('unhandledRejection', onUnhandled)
    try {
      const q = createDirLoadQueue(m.load)
      q.request('/r/a')
      await m.finish('/r/a', true)
      q.request('/r/a')
      expect(m.calls).toEqual(['/r/a', '/r/a'])
      await new Promise((r) => setTimeout(r, 0))
      expect(onUnhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('load 가 동기로 던져도 대기 표시가 남지 않는다', async () => {
    const q = createDirLoadQueue(() => {
      throw new Error('sync')
    })
    q.request('/r/a')
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(q.isPending('/r/a')).toBe(false)
  })

  // 로딩 표시의 근거 — 읽는 동안(이어 읽기까지 포함) pending 이고, 다 끝나야 풀린다
  it('읽는 동안은 pending 이고, 이어 읽기까지 끝나야 풀린다', async () => {
    const m = manualLoad()
    const seen: string[][] = []
    const q = createDirLoadQueue(m.load, (p) => seen.push([...p]))
    expect(q.isPending('/r/a')).toBe(false)
    q.request('/r/a')
    expect(q.isPending('/r/a')).toBe(true)
    q.request('/r/a')
    await m.finish('/r/a')
    expect(q.isPending('/r/a')).toBe(true) // 이어 읽는 중
    await m.finish('/r/a')
    expect(q.isPending('/r/a')).toBe(false)
    // 켜질 때 한 번, 꺼질 때 한 번 — 이어 읽기 사이에 깜빡이지 않는다
    expect(seen).toEqual([['/r/a'], []])
  })
})

// 새로고침 한 번이 펼친 폴더 수만큼 readdir 를 한꺼번에 보내면, 끊긴 공유 드라이브에서 libuv 스레드풀(기본 4)이
// 전부 묶여 main 의 다른 fs 호출(파일 탭 저장, 경로 probe)까지 멈춘다 — pathProbe 가 지키는 "풀의 절반은 비워
// 둔다" 규칙을 여기서도 지킨다 (최종 리뷰 Important 1)
describe('createDirLoadQueue — 폴더 사이의 동시 읽기 상한', () => {
  it(`한 번에 ${DIR_READ_CONCURRENCY} 개까지만 읽고, 나머지는 온 순서대로 기다린다`, async () => {
    expect(DIR_READ_CONCURRENCY).toBe(2)
    const m = manualLoad()
    const q = createDirLoadQueue(m.load)
    for (const d of ['/r/a', '/r/b', '/r/c', '/r/d']) q.request(d)
    expect(m.calls).toEqual(['/r/a', '/r/b'])
    await m.finish('/r/a')
    expect(m.calls).toEqual(['/r/a', '/r/b', '/r/c'])
    await m.finish('/r/b')
    expect(m.calls).toEqual(['/r/a', '/r/b', '/r/c', '/r/d'])
  })

  it('기다리는 폴더에 요청이 더 와도 한 번만 읽는다', async () => {
    const m = manualLoad()
    const q = createDirLoadQueue(m.load)
    for (const d of ['/r/a', '/r/b', '/r/c', '/r/c', '/r/c']) q.request(d)
    await m.finish('/r/a')
    await m.finish('/r/b')
    await m.finish('/r/c')
    // Requests that arrive while it waits are covered by the read it has not started yet
    expect(m.calls).toEqual(['/r/a', '/r/b', '/r/c'])
  })

  it('기다리는 폴더도 pending 이다 — 오래 기다리면 그 행에도 스피너가 뜬다', async () => {
    const m = manualLoad()
    const seen: string[][] = []
    const q = createDirLoadQueue(m.load, (p) => seen.push([...p].sort()))
    for (const d of ['/r/a', '/r/b', '/r/c']) q.request(d)
    expect(q.isPending('/r/c')).toBe(true)
    expect(seen.at(-1)).toEqual(['/r/a', '/r/b', '/r/c'])
    await m.finish('/r/a')
    await m.finish('/r/b')
    await m.finish('/r/c')
    expect(q.isPending('/r/c')).toBe(false)
    expect(seen.at(-1)).toEqual([])
  })

  it('이어 읽기는 줄 뒤로 선다 — 계속 바뀌는 폴더 하나가 자리를 붙잡지 않는다', async () => {
    const m = manualLoad()
    const q = createDirLoadQueue(m.load)
    q.request('/r/a')
    q.request('/r/b')
    q.request('/r/a') // a 를 읽는 동안 바뀌었다
    q.request('/r/c')
    await m.finish('/r/a')
    expect(m.calls).toEqual(['/r/a', '/r/b', '/r/c'])
    await m.finish('/r/b')
    expect(m.calls).toEqual(['/r/a', '/r/b', '/r/c', '/r/a'])
    expect(m.maxInFlight.get('/r/a')).toBe(1)
  })
})

describe('planBatchReload — 한 묶음에서 무엇을 다시 읽는가', () => {
  const root = '/r'
  it('펼쳐진 폴더와 루트만 다시 읽고, 캐시에 없는 폴더는 건드리지 않는다', () => {
    const cached = new Set(['/r', '/r/a', '/r/b'])
    const expanded = new Set(['/r/a'])
    const plan = planBatchReload(['/r', '/r/a', '/r/b', '/r/never'], {
      root,
      isCached: (d) => cached.has(d),
      isExpanded: (d) => expanded.has(d)
    })
    expect(plan.reload).toEqual(['/r', '/r/a'])
    // 접힌 채 캐시에 남은 폴더는 지금 읽지 않고 캐시를 버린다 — 다시 펼칠 때 새로 읽힌다
    expect(plan.evict).toEqual(['/r/b'])
  })

  it('같은 폴더가 여러 번 와도 한 번만 계획한다', () => {
    const plan = planBatchReload(['/r/a', '/r/a', '/r/a'], {
      root,
      isCached: () => true,
      isExpanded: () => true
    })
    expect(plan.reload).toEqual(['/r/a'])
  })
})

// npm install 이 펼친 폴더에 100ms 마다 묶음을 보내면, 짧은 읽기마다 스피너가 켜졌다 꺼져 깜빡인다.
// 읽기가 ROW_SPINNER_DELAY_MS 넘게 이어질 때만 보인다
describe('createDelayedPending — 행 스피너의 보이기 지연', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('지연보다 짧은 읽기는 한 번도 보이지 않는다', () => {
    vi.useFakeTimers()
    const shown: string[][] = []
    const d = createDelayedPending((s) => shown.push([...s]))
    for (let i = 0; i < 10; i++) {
      d.update(new Set(['/r/a']))
      vi.advanceTimersByTime(ROW_SPINNER_DELAY_MS - 60)
      d.update(new Set())
      vi.advanceTimersByTime(60)
    }
    expect(shown).toEqual([])
  })

  it('지연을 넘긴 읽기는 보이고, 끝나면 바로 사라진다', () => {
    vi.useFakeTimers()
    const shown: string[][] = []
    const d = createDelayedPending((s) => shown.push([...s]))
    d.update(new Set(['/r/a']))
    vi.advanceTimersByTime(ROW_SPINNER_DELAY_MS - 1)
    expect(shown).toEqual([])
    vi.advanceTimersByTime(1)
    expect(shown).toEqual([['/r/a']])
    d.update(new Set())
    expect(shown).toEqual([['/r/a'], []])
  })

  it('clear 는 걸린 타이머를 모두 거두고, 그 뒤에도 다시 쓸 수 있다', () => {
    vi.useFakeTimers()
    const shown: string[][] = []
    const d = createDelayedPending((s) => shown.push([...s]))
    d.update(new Set(['/r/a']))
    d.clear()
    vi.advanceTimersByTime(ROW_SPINNER_DELAY_MS * 2)
    expect(shown).toEqual([])
    d.update(new Set(['/r/b']))
    vi.advanceTimersByTime(ROW_SPINNER_DELAY_MS)
    expect(shown).toEqual([['/r/b']])
  })
})

describe('planRefresh — 새로고침은 펼친 폴더를 그대로 두고 다시 읽는다', () => {
  const R = 'D:/proj'
  const p = (...parts: string[]): string => [R, ...parts].join('/')

  it('루트와 펼친 폴더를 다시 읽고, 접힌 폴더의 캐시는 버린다', () => {
    const plan = planRefresh({ root: R, cached: [R, p('a'), p('a', 'b'), p('c')], expanded: [p('a'), p('a', 'b')] })
    expect(plan.reload).toEqual([R, p('a'), p('a', 'b')])
    expect(plan.evict).toEqual([p('c')])
  })

  it('접힌 부모 아래의 펼친 폴더도 다시 읽는다 — 부모를 다시 열면 지금 디스크가 보인다', () => {
    const plan = planRefresh({ root: R, cached: [R, p('a'), p('a', 'b')], expanded: [p('a', 'b')] })
    expect(plan.reload).toEqual([R, p('a', 'b')])
    expect(plan.evict).toEqual([p('a')])
  })

  it('캐시에 없어도 펼쳐져 있으면 읽고, 루트는 늘 읽는다', () => {
    expect(planRefresh({ root: R, cached: [], expanded: [p('x')] }).reload).toEqual([R, p('x')])
  })

  it('루트 밖의 펼친 키는 읽지 않고, 루트 밖 캐시는 버린다', () => {
    const plan = planRefresh({ root: R, cached: [R, 'D:/other', 'D:/other/y'], expanded: ['D:/other', p('a')] })
    expect(plan.reload).toEqual([R, p('a')])
    expect(plan.evict).toEqual(['D:/other', 'D:/other/y'])
  })

  it('같은 폴더는 한 번만, 루트가 펼친 목록에 있어도 한 번만', () => {
    const plan = planRefresh({ root: R, cached: [R], expanded: [R, p('a'), p('a')] })
    expect(plan.reload).toEqual([R, p('a')])
    expect(plan.evict).toEqual([])
  })

  // 상한이 생긴 뒤로는 순서가 곧 기다리는 순서다 — 화면에 보이는 폴더를 먼저, 접힌 부모 아래 숨은 폴더를 나중에
  it('화면에 보이는 폴더를 숨은 폴더보다 먼저 읽는다', () => {
    const plan = planRefresh({ root: R, cached: [], expanded: [p('a', 'b'), p('c'), p('c', 'd')] })
    expect(plan.reload).toEqual([R, p('c'), p('c', 'd'), p('a', 'b')])
  })

  // 최종 리뷰 minor 2: 원문 비교였을 때는 끝 구분자나 대소문자만 다른 루트 키를 루트와 따로 한 번 더 읽었다
  it('루트를 다르게 적은 키는 루트로 친다', () => {
    expect(planRefresh({ root: R, cached: [], expanded: [`${R}/`, p('a')] }).reload).toEqual([R, p('a')])
  })

  it('부모가 자식보다 먼저 온다', () => {
    const plan = planRefresh({ root: R, cached: [], expanded: [p('a', 'b', 'c'), p('a'), p('a', 'b')] })
    expect(plan.reload).toEqual([R, p('a'), p('a', 'b'), p('a', 'b', 'c')])
  })
})
