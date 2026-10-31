import { describe, it, expect } from 'vitest'
import { parseAccountPlan, readAccountPlan } from './plan'

const ACCESS = 'sk-ant-oat01-ACCESS-SECRET'
const REFRESH = 'sk-ant-ort01-REFRESH-SECRET'

function creds(oauth: Record<string, unknown>): string {
  return JSON.stringify({ claudeAiOauth: { accessToken: ACCESS, refreshToken: REFRESH, expiresAt: 1, ...oauth } })
}

describe('parseAccountPlan', () => {
  it.each([
    ['max', 'max'],
    ['claude_max_20x', 'max'],
    ['default_claude_max_5x', 'max'],
    ['Claude Team', 'team'],
    ['team', 'team'],
    ['ultra', 'ultra'],
    ['default_claude_ultra', 'ultra'],
    ['pro', 'pro'],
    ['claude_pro', 'pro'],
    ['Enterprise', 'enterprise'],
    ['free', 'free'],
    ['claudeMaxPlan', 'max']
  ])('subscriptionType %s gives %s', (raw, id) => {
    const plan = parseAccountPlan(creds({ subscriptionType: raw }), null)
    expect(plan.id).toBe(id)
    expect(plan.raw).toBe(raw)
  })

  it('hasSessionWindow is false only for ultra', () => {
    for (const raw of ['free', 'pro', 'max', 'team', 'enterprise', 'mystery']) {
      expect(parseAccountPlan(creds({ subscriptionType: raw }), null).hasSessionWindow).toBe(true)
    }
    expect(parseAccountPlan(creds({ subscriptionType: 'ultra' }), null).hasSessionWindow).toBe(false)
    expect(parseAccountPlan(creds({ rateLimitTier: 'default_claude_ultra' }), null).hasSessionWindow).toBe(false)
  })

  it('subscriptionType wins over rateLimitTier', () => {
    const plan = parseAccountPlan(creds({ subscriptionType: 'team', rateLimitTier: 'default_claude_max_5x' }), null)
    expect(plan.id).toBe('team')
  })

  it('falls through to rateLimitTier when subscriptionType is empty or unrecognised', () => {
    expect(parseAccountPlan(creds({ subscriptionType: '', rateLimitTier: 'default_claude_ultra' }), null).id).toBe('ultra')
    const plan = parseAccountPlan(creds({ subscriptionType: 'zzz', rateLimitTier: 'claude_max_20x' }), null)
    expect(plan.id).toBe('max')
    expect(plan.raw).toBe('claude_max_20x')
  })

  it('falls back to the oauthAccount plan fields of .claude.json', () => {
    const claudeJson = JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c', organizationType: 'claude_max' } })
    expect(parseAccountPlan(null, claudeJson)).toEqual({ id: 'max', raw: 'claude_max', hasSessionWindow: true })
    expect(parseAccountPlan(creds({}), claudeJson).id).toBe('max')
  })

  it('credentials take priority over .claude.json', () => {
    const claudeJson = JSON.stringify({ oauthAccount: { organizationType: 'claude_pro' } })
    expect(parseAccountPlan(creds({ subscriptionType: 'ultra' }), claudeJson).id).toBe('ultra')
  })

  it('keeps the raw string of an unrecognised plan', () => {
    expect(parseAccountPlan(creds({ subscriptionType: 'Gold Tier' }), null)).toEqual({
      id: 'unknown',
      raw: 'Gold Tier',
      hasSessionWindow: true
    })
  })

  it('gives unknown for empty, missing and malformed input', () => {
    const unknown = { id: 'unknown', raw: null, hasSessionWindow: true }
    expect(parseAccountPlan(creds({ subscriptionType: '' }), null)).toEqual(unknown)
    expect(parseAccountPlan(null, null)).toEqual(unknown)
    expect(parseAccountPlan('', '')).toEqual(unknown)
    expect(parseAccountPlan('{not json', '{also not')).toEqual(unknown)
    expect(parseAccountPlan('[1,2]', '"str"')).toEqual(unknown)
    expect(parseAccountPlan(JSON.stringify({ claudeAiOauth: 'x' }), JSON.stringify({ oauthAccount: 5 }))).toEqual(unknown)
    expect(parseAccountPlan(creds({ subscriptionType: 42 }), null)).toEqual(unknown)
  })

  it('never carries the access or refresh token', () => {
    const plan = parseAccountPlan(creds({ subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' }), null)
    expect(Object.keys(plan).sort()).toEqual(['hasSessionWindow', 'id', 'raw'])
    const text = JSON.stringify(plan)
    expect(text).not.toContain(ACCESS)
    expect(text).not.toContain(REFRESH)
    const odd = parseAccountPlan(creds({ subscriptionType: 'weird' }), null)
    expect(JSON.stringify(odd)).not.toContain(ACCESS)
    expect(JSON.stringify(odd)).not.toContain(REFRESH)
  })
})

describe('readAccountPlan', () => {
  it('asks the reader for the two files and parses them', async () => {
    const asked: string[] = []
    const plan = await readAccountPlan(async (name) => {
      asked.push(name)
      return name === '.credentials.json' ? creds({ subscriptionType: 'ultra' }) : null
    })
    expect(plan.id).toBe('ultra')
    expect(asked).toContain('.credentials.json')
  })

  it('treats a throwing or missing reader as unknown', async () => {
    expect((await readAccountPlan(async () => null)).id).toBe('unknown')
    expect(
      (
        await readAccountPlan(async () => {
          throw new Error('EACCES')
        })
      ).id
    ).toBe('unknown')
  })
})
