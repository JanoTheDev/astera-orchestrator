import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { approvalMessage, installPlugin } from './plugins'
import { PLUGIN_TRUST_WARNING } from '../core/plugins/manifest'

const INSPECTION = {
  id: '@acme/astera-jira',
  name: '@acme/astera-jira',
  displayName: 'Jira',
  version: '1.0.0',
  apiVersion: '1',
  entry: './dist/plugin.js',
  capabilities: [],
  permissions: ['jobs.read', 'jobs.create'],
  compatible: true
}

/** A Host that answers inspect with `inspection` and records every call. */
const host = (inspection: { status: number; body: unknown } = { status: 200, body: INSPECTION }) => {
  const calls: { cmd: string; args: Record<string, unknown>; request: string | undefined }[] = []
  const call = async (cmd: string, args: Record<string, unknown>, request: string | undefined) => {
    calls.push({ cmd, args, request })
    return cmd === 'plugins-inspect' ? inspection : { status: 200, body: { id: '@acme/astera-jira', installed: true } }
  }
  return { calls, call }
}

const CWD = path.resolve('/work/plugins')

describe('installPlugin', () => {
  it('resolves --path against the shell’s folder and asks for approval without --yes or --grant, installing nothing', async () => {
    const h = host()
    const r = await installPlugin({ args: { path: 'jira' }, cwd: CWD, request: 'req-1', call: h.call })
    expect(r).toEqual({ approve: INSPECTION })
    expect(h.calls).toEqual([{ cmd: 'plugins-inspect', args: { path: path.join(CWD, 'jira') }, request: undefined }])
  })

  it('grants what the plugin asks for with --yes, pinning what it showed, under the request id', async () => {
    const h = host()
    const r = await installPlugin({ args: { path: 'jira', yes: true }, cwd: CWD, request: 'req-1', call: h.call })
    expect(r).toEqual({ status: 200, body: { id: '@acme/astera-jira', installed: true } })
    expect(h.calls[1]).toEqual({
      cmd: 'plugins-install',
      args: { path: path.join(CWD, 'jira'), grant: ['jobs.read', 'jobs.create'], expect: { name: '@acme/astera-jira', version: '1.0.0' } },
      request: 'req-1'
    })
  })

  it('grants exactly the --grant list, trimmed, and it wins over --yes', async () => {
    const h = host()
    await installPlugin({ args: { path: '/abs/jira', grant: 'jobs.read, jobs.create,', yes: true }, cwd: CWD, request: undefined, call: h.call })
    expect(h.calls[1].args.grant).toEqual(['jobs.read', 'jobs.create'])
    expect(h.calls[1].args.path).toBe(path.resolve('/abs/jira'))
  })

  it('takes an empty --grant as granting nothing', async () => {
    const h = host()
    await installPlugin({ args: { path: 'jira', grant: '' }, cwd: CWD, request: undefined, call: h.call })
    expect(h.calls[1].args.grant).toEqual([])
  })

  it('hands back an inspection the Host refused, and an answer that never came', async () => {
    const refused = host({ status: 400, body: { error: 'no package.json in /work/plugins/jira' } })
    expect(await installPlugin({ args: { path: 'jira', yes: true }, cwd: CWD, request: undefined, call: refused.call })).toEqual({
      status: 400,
      body: { error: 'no package.json in /work/plugins/jira' }
    })
    expect(refused.calls).toHaveLength(1)
    const gone = { calls: 0, call: async () => ({ unreachable: 'no Host' }) }
    expect(await installPlugin({ args: { path: 'jira', yes: true }, cwd: CWD, request: undefined, call: gone.call })).toEqual({ unreachable: 'no Host' })
  })

  it('refuses a missing --path before asking the Host', async () => {
    const h = host()
    expect(await installPlugin({ args: { yes: true }, cwd: CWD, request: undefined, call: h.call })).toEqual({
      status: 400,
      body: { error: 'plugins install needs --path <folder>' }
    })
    expect(h.calls).toEqual([])
  })
})

describe('approvalMessage', () => {
  it('says what the plugin is and asks for, that it is trusted code, and how to approve', () => {
    expect(approvalMessage(INSPECTION)).toBe(
      `Jira 1.0.0 (@acme/astera-jira) asks for: jobs.read, jobs.create. ${PLUGIN_TRUST_WARNING} Approve with --yes, or name what to grant with --grant <list>.`
    )
  })
  it('says when it asks for nothing, and when it will not run here', () => {
    expect(approvalMessage({ ...INSPECTION, permissions: [], compatible: false, reason: 'this Astera does not run event plugins yet' })).toBe(
      `Jira 1.0.0 (@acme/astera-jira) asks for: no permissions. ${PLUGIN_TRUST_WARNING} It will not run here: this Astera does not run event plugins yet. Approve with --yes, or name what to grant with --grant <list>.`
    )
  })
})
