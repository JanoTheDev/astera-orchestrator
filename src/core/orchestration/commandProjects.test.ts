// W7-B: `projects-set`'s project settings flags (projectSettingsArgs) through handleCommand: each one round trips, an
// empty value clears it, the two the app keeps (`--test-command`, `--account`) go through their deps, and only the
// person sets them. Delivery's own flags are commandDelivery.test.ts's.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import type { Project } from './types'
import { HOST_CALLER } from '../host/driver'

const NOW = '2026-10-18T00:00:00.000Z'
const REPO = '/repo'

const setup = (o: { app?: boolean } = {}) => {
  const project: Project = { id: 'p1', path: REPO, name: 'shop', addedAt: NOW }
  const box: { state: OrchState } = { state: { ...emptyState(), projects: [project] } }
  const saved: [string, string | null][] = []
  const accounts: [string, string | null][] = []
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    now: () => NOW,
    listAccounts: () => [{ id: 'acc', label: 'acc', provider: 'claude' }],
    ...(o.app === false
      ? {}
      : {
          saveTestCommand: async (p: string, command: string | null) => {
            saved.push([p, command])
            return command === null ? null : 'astera:test'
          },
          setProjectAccount: async (p: string, id: string | null) => void accounts.push([p, id])
        })
  } as unknown as OrchServerDeps
  const call = (args: Record<string, unknown>, sessionId = HOST_CALLER) => handleCommand(deps, { sessionId }, 'projects-set', { id: 'p1', ...args })
  return { call, saved, accounts, project: () => box.state.projects[0] }
}

describe('projects-set project settings (W7-B)', () => {
  it('sets and clears each setting flag', async () => {
    const h = setup()
    const cases: [string, unknown, keyof Project, unknown][] = [
      ['autoApprove', 'true', 'autoApprove', true],
      ['concurrency', '4', 'concurrency', 4],
      ['reviewRounds', '2', 'reviewRounds', 2],
      ['replan', 'off', 'replan', 'off'],
      ['testConfig', 'lint', 'testConfigId', 'lint']
    ]
    for (const [flag, value, field, stored] of cases) {
      expect((await h.call({ [flag]: value })).status).toBe(200)
      expect(h.project()[field]).toEqual(stored)
    }
    for (const [flag, , field] of cases) {
      // --auto-approve has no empty value: false is its default, so false clears it
      expect((await h.call({ [flag]: flag === 'autoApprove' ? 'false' : '' })).status).toBe(200)
      expect(h.project()).not.toHaveProperty(field)
    }
    expect(h.project()).toEqual({ id: 'p1', path: REPO, name: 'shop', addedAt: NOW })
  })

  it('refuses bad values and changes nothing', async () => {
    const h = setup()
    for (const args of [{ concurrency: '0' }, { concurrency: '101' }, { reviewRounds: '0' }, { replan: 'later' }, { autoApprove: 'maybe' }, { testConfig: 'x', testCommand: 'npm test' }, {}])
      expect((await h.call(args)).status).toBe(400)
    expect(h.project()).toEqual({ id: 'p1', path: REPO, name: 'shop', addedAt: NOW })
  })

  it('is refused to an agent session and an unknown project', async () => {
    const h = setup()
    expect((await h.call({ concurrency: '2' }, 'worker-session')).status).toBe(403)
    expect((await h.call({ id: 'nope', concurrency: '2' })).status).toBe(404)
    expect(h.project().concurrency).toBeUndefined()
  })

  it('saves --test-command through the app and stores its id; an empty one removes it', async () => {
    const h = setup()
    expect((await h.call({ testCommand: ' npm test ' })).status).toBe(200)
    expect(h.saved).toEqual([[REPO, 'npm test']])
    expect(h.project().testConfigId).toBe('astera:test')
    expect((await h.call({ testCommand: '' })).status).toBe(200)
    expect(h.saved[1]).toEqual([REPO, null])
    expect(h.project()).not.toHaveProperty('testConfigId')
  })

  it('answers 409 for --test-command and --account with no app, before writing anything', async () => {
    const h = setup({ app: false })
    expect((await h.call({ testCommand: 'npm test', concurrency: '2' })).status).toBe(409)
    expect((await h.call({ account: 'acc' })).status).toBe(409)
    expect(h.project().concurrency).toBeUndefined()
  })

  it('sets a known --account through the app, clears it on empty, and refuses an unknown one with 404', async () => {
    const h = setup()
    expect((await h.call({ account: 'ghost' })).status).toBe(404)
    expect(h.accounts).toEqual([])
    expect((await h.call({ account: 'acc' })).status).toBe(200)
    expect((await h.call({ account: '' })).status).toBe(200)
    expect(h.accounts).toEqual([
      [REPO, 'acc'],
      [REPO, null]
    ])
  })
})
