import { describe, expect, it } from 'vitest'
import type { Account, McpInput } from '../../../../core/types'
import {
  accountsByProvider, byAccount, canInstall, defaultPick, filledValues, initialValues, installedIn, mcpOrigin, missingInputs, prunedOwned, readOwned, removable, withInstalled, withoutInstalled, writeOwned,
  normaliseRepo, providerPick, repoProblem, splitResults, toggleProvider
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
  it('an MCP server is Astera’s, the finder’s only when it recorded the install, else the person’s', () => {
    const owned = withInstalled(new Set(), ['a', 'b'], 'github')
    expect(mcpOrigin({ accountId: 'a', name: 'Astera', transport: 'stdio' }, owned)).toBe('astera')
    expect(mcpOrigin({ accountId: 'a', name: 'github', transport: 'http' }, owned)).toBe('finder')
    expect(mcpOrigin({ accountId: 'c', name: 'github', transport: 'http' }, owned)).toBe('user')
    expect(mcpOrigin({ accountId: 'a', name: 'mine', transport: 'stdio' }, owned)).toBe('user')
    expect(removable('finder')).toBe(true)
    expect(removable('user')).toBe(false)
    expect(removable('astera')).toBe(false)
    const after = withoutInstalled(owned, 'a', 'github')
    expect(mcpOrigin({ accountId: 'a', name: 'github', transport: 'http' }, after)).toBe('user')
  })
  it('the record survives storage, ignores bad values, and drops servers no longer installed', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    const owned = withInstalled(new Set(), ['a'], 'github')
    writeOwned(storage, owned)
    expect(readOwned(storage)).toEqual(owned)
    store.set('astera.finder.mcpInstalls', '{bad')
    expect(readOwned(storage).size).toBe(0)
    expect(readOwned(undefined).size).toBe(0)
    expect(prunedOwned(withInstalled(new Set(), ['a', 'b'], 'x'), [{ accountId: 'b', name: 'x', transport: 'stdio' }])).toEqual(withInstalled(new Set(), ['b'], 'x'))
  })
  it('only a finder skill is removable', () => {
    for (const o of ['astera', 'finder', 'user'] as const) expect(removable(o)).toBe(o === 'finder')
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
