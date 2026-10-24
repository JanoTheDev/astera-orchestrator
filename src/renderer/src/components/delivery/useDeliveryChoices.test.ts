import { describe, expect, it } from 'vitest'
import { deliveryOptionsOf } from './useDeliveryChoices'

// Keys and their params, so the test reads what is shown without a catalog
const t = (key: string, params?: Record<string, string | number>): string => (params ? `${key}${JSON.stringify(params)}` : key)
const setup = { isGitRepo: true, remoteUrl: null, ghSignedIn: false, branch: 'main' }

describe('deliveryOptionsOf', () => {
  it('a folder with no remote offers merge and review, and a saved pull request falls back to merge with why', () => {
    const o = deliveryOptionsOf(setup, 'pr', undefined, t)
    expect(o.options).toEqual([
      { value: 'merge', label: 'delivery.merge{"branch":"main"}' },
      { value: 'manual', label: 'delivery.manual' }
    ])
    expect(o.mode).toBe('merge')
    expect(o.reason).toBe('delivery.off.notGitHub')
  })

  it('names the push target: GitHub, or the remote host, on the delivery branch the project set', () => {
    const gh = deliveryOptionsOf({ ...setup, remoteUrl: 'git@github.com:me/app.git', ghSignedIn: true }, 'push', 'release', t)
    expect(gh.options.map((x) => x.label)).toEqual([
      'delivery.merge{"branch":"release"}',
      'delivery.push{"branch":"release"}',
      'delivery.pr',
      'delivery.manual'
    ])
    expect(gh).toMatchObject({ mode: 'push', reason: null })
    const lab = deliveryOptionsOf({ ...setup, remoteUrl: 'https://gitlab.com/me/app.git' }, 'push', undefined, t)
    expect(lab.options.find((x) => x.value === 'push')?.label).toBe('delivery.pushTo{"branch":"main","remote":"gitlab.com"}')
  })

  it('an unknown setup (still loading, or another machine) offers every delivery, the saved one kept', () => {
    const o = deliveryOptionsOf(null, 'pr', undefined, t)
    expect(o.options.map((x) => x.value)).toEqual(['merge', 'push', 'pr', 'manual'])
    expect(o.options[0].label).toBe('delivery.merge{"branch":"delivery.defaultBranch"}')
    expect(o).toMatchObject({ mode: 'pr', reason: null })
  })
})
