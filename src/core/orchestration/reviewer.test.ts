import { describe, it, expect } from 'vitest'
import { pickReviewer } from './reviewer'
import type { Account } from '../types'

const acc = (id: string, provider: 'claude' | 'codex', createdAt: string): Account => ({
  id, label: id, configDir: `D:/cfg/${id}`, color: '#fff', createdAt, provider
})

describe('pickReviewer', () => {
  it('구현자와 다른 provider 의 계정을 고른다', () => {
    const accounts = [acc('a1', 'claude', '2026-01-01T00:00:00.000Z'), acc('b1', 'codex', '2026-01-02T00:00:00.000Z')]
    expect(pickReviewer({ implProvider: 'claude', accounts, loggedInIds: new Set(['a1', 'b1']) }))
      .toEqual({ provider: 'codex', accountId: 'b1' })
  })

  // W1-A (owner decision 2026-10-17): with only one provider, review on it rather than not at all —
  // the reviewer model (resolveReviewerModel) keeps it off the implementer's model.
  it('구현자와 같은 provider 만 있으면 그 provider 로 검토한다 (sameProvider)', () => {
    const accounts = [acc('a1', 'claude', '2026-01-01T00:00:00.000Z')]
    expect(pickReviewer({ implProvider: 'claude', accounts, loggedInIds: new Set(['a1']) }))
      .toEqual({ provider: 'claude', accountId: 'a1', sameProvider: true })
  })

  it('같은 provider 계정도 로그인돼 있지 않으면 null 이다', () => {
    const accounts = [acc('a1', 'claude', '2026-01-01T00:00:00.000Z')]
    expect(pickReviewer({ implProvider: 'claude', accounts, loggedInIds: new Set() })).toBeNull()
  })

  it('로그인되지 않은 계정은 쓰지 않는다', () => {
    const accounts = [acc('a1', 'claude', '2026-01-01T00:00:00.000Z'), acc('b1', 'codex', '2026-01-02T00:00:00.000Z')]
    expect(pickReviewer({ implProvider: 'claude', accounts, loggedInIds: new Set(['a1']) })).toBeNull()
  })

  // defaultAccountIdOf 의 규칙을 그대로 물려받는다 — UI 가 default 배지를 붙이는 계정과 갈라지면 안 된다
  it('같은 provider 에 계정이 여럿이면 가장 먼저 등록된 로그인 계정이다', () => {
    const accounts = [
      acc('b2', 'codex', '2026-01-03T00:00:00.000Z'),
      acc('b1', 'codex', '2026-01-02T00:00:00.000Z')
    ]
    expect(pickReviewer({ implProvider: 'claude', accounts, loggedInIds: new Set(['b1', 'b2']) }))
      .toEqual({ provider: 'codex', accountId: 'b1' })
  })

  it('계정이 하나도 없으면 null 이다', () => {
    expect(pickReviewer({ implProvider: 'claude', accounts: [], loggedInIds: new Set() })).toBeNull()
  })
})

// T5b: a review skips a full account
describe('pickReviewer — by room (T5b)', () => {
  const T = '2026-01-01T00:00:00.000Z'
  const a = (id: string, provider: 'claude' | 'codex'): Account => ({ id, label: id, configDir: `/c/${id}`, color: '#888', createdAt: T, provider })
  const accounts = [a('c1', 'claude'), a('x1', 'codex'), a('x2', 'codex')]
  const all = new Set(accounts.map((x) => x.id))
  it('takes the provider\'s account with room, not its default', () => {
    expect(pickReviewer({ implProvider: 'claude', accounts, loggedInIds: all, best: (p) => (p === 'codex' ? 'x2' : undefined) })).toEqual({ provider: 'codex', accountId: 'x2' })
  })
  it('skips a provider whose accounts are all full', () => {
    expect(pickReviewer({ implProvider: 'claude', accounts, loggedInIds: all, best: (p) => (p === 'codex' ? null : 'c1') })).toBeNull()
    expect(pickReviewer({ implProvider: 'claude', accounts: [a('c1', 'claude'), a('c2', 'claude')], loggedInIds: new Set(['c1', 'c2']), best: (p) => (p === 'claude' ? 'c2' : null) })).toEqual({ provider: 'claude', accountId: 'c2', sameProvider: true })
  })
})
