import { describe, expect, it } from 'vitest'
import type { Account, McpInput } from '../../../../core/types'
import {
  accountsByProvider, byAccount, canInstall, defaultPick, filledValues, initialValues, installedIn, mcpOrigin, mcpRemovable, missingInputs,
  normaliseRepo, providerPick, repoProblem, skillRemovable, splitResults, toggleProvider
} from './finderLogic'

const acc = (id: string, provider?: 'claude' | 'codex'): Account => ({ id, label: id.toUpperCase(), configDir: `/c/${id}`, color: '', createdAt: '', provider })

describe('accounts', () => {
  const accounts = [acc('a'), acc('b', 'codex'), acc('c', 'claude')]
  it('groups by provider, absent meaning claude, and picks every account by default', () => {
    const g = accountsByProvider(accounts)
    expect(g.claude.map((a) => a.id)).toEqual(['a', 'c'])
    expect(g.codex.map((a) => a.id)).toEqual(['b'])
    expect([...defaultPick(accounts)]).toEqual(['a', 'b', 'c'])
  })
  it('a provider box is mixed on a partial pick, disabled with no accounts, and toggles all of its accounts', () => {
    expect(providerPick(['a', 'c'], new Set(['a']))).toEqual({ checked: false, indeterminate: true, disabled: false })
    expect(providerPick([], new Set())).toEqual({ checked: false, indeterminate: false, disabled: true })
    expect([...toggleProvider(['a', 'c'], new Set(['a', 'b']))].sort()).toEqual(['a', 'b', 'c'])
    expect([...toggleProvider(['a', 'c'], new Set(['a', 'b', 'c']))]).toEqual(['b'])
  })
})

describe('MCP inputs', () => {
  const inputs: McpInput[] = [
    { name: 'TOKEN', description: '', required: true, secret: true },
    { name: 'REGION', description: '', required: false, secret: false, default: 'eu' },
    { name: 'OPT', description: '', required: false, secret: false }
  ]
  it('starts from defaults, names the required ones still empty, and sends only what was filled', () => {
    const v = initialValues(inputs)
    expect(v).toEqual({ TOKEN: '', REGION: 'eu', OPT: '' })
    expect(missingInputs(inputs, v)).toEqual(['TOKEN'])
    expect(missingInputs(inputs, { ...v, TOKEN: '  ' })).toEqual(['TOKEN'])
    expect(missingInputs(inputs, { ...v, TOKEN: 'x' })).toEqual([])
    expect(filledValues({ ...v, TOKEN: 'x' })).toEqual({ TOKEN: 'x', REGION: 'eu' })
  })
  it('installs only with an account and nothing missing', () => {
    expect(canInstall(new Set(['a']), [])).toBe(true)
    expect(canInstall(new Set(), [])).toBe(false)
    expect(canInstall(new Set(['a']), ['TOKEN'])).toBe(false)
  })
})

describe('installed lists', () => {
  it('the astera server is Astera’s and not removable; another MCP server is; only a finder skill is', () => {
    expect(mcpOrigin({ accountId: 'a', name: 'Astera', transport: 'stdio' })).toBe('astera')
    expect(mcpRemovable({ accountId: 'a', name: 'astera', transport: 'stdio' })).toBe(false)
    expect(mcpOrigin({ accountId: 'a', name: 'github', transport: 'http' })).toBeNull()
    expect(mcpRemovable({ accountId: 'a', name: 'github', transport: 'http' })).toBe(true)
    const skill = { accountId: 'a', name: 's', description: '' }
    expect(skillRemovable({ ...skill, origin: 'finder' })).toBe(true)
    expect(skillRemovable({ ...skill, origin: 'user' })).toBe(false)
    expect(skillRemovable({ ...skill, origin: 'astera' })).toBe(false)
  })
  it('groups by account in account order, sorted by name, empty accounts kept', () => {
    const items = [{ accountId: 'b', name: 'z' }, { accountId: 'a', name: 'y' }, { accountId: 'a', name: 'x' }]
    const g = byAccount(items, [acc('a'), acc('b'), acc('c')])
    expect(g.map((x) => [x.account.id, x.items.map((i) => i.name)])).toEqual([['a', ['x', 'y']], ['b', ['z']], ['c', []]])
    expect([...installedIn(items, 'z')]).toEqual(['b'])
  })
  it('splits install results by account label', () => {
    const r = splitResults(
      { note: 'n', results: [{ accountId: 'a', ok: true }, { accountId: 'b', ok: false, error: 'cli', message: 'boom' }] },
      (id) => id.toUpperCase()
    )
    expect(r).toEqual({ ok: ['A'], failed: [{ label: 'B', message: 'boom' }] })
  })
})

describe('repoProblem', () => {
  it('takes owner/repo and a pasted GitHub URL, refuses anything else and duplicates', () => {
    expect(repoProblem('owner/repo', [])).toBeNull()
    expect(normaliseRepo(' https://github.com/owner/repo.git/ ')).toBe('owner/repo')
    expect(repoProblem('https://github.com/owner/repo', [])).toBeNull()
    expect(repoProblem('owner', [])).toBe('format')
    expect(repoProblem('owner/repo/extra', [])).toBe('format')
    expect(repoProblem('own er/repo', [])).toBe('format')
    expect(repoProblem('owner/..', [])).toBe('format')
    expect(repoProblem('Owner/Repo', ['owner/repo'])).toBe('duplicate')
  })
})
