import { describe, expect, it, vi, beforeEach } from 'vitest'

const handlers = vi.hoisted(() => ({ current: undefined as undefined | { openTerminalAt: (cwd: string) => Promise<void> } }))
const open = vi.hoisted(() => vi.fn(async () => ({ id: 'term-1' })))

vi.mock('react', () => ({ useEffect: (fn: () => void) => fn() }))
vi.mock('../components/shell/navigation', () => ({
  registerNavigation: (h: typeof handlers.current) => { handlers.current = h as never; return () => {} }
}))
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn() } }))

import { useNavigation } from './useNavigation'

describe('navigation.openTerminalAt', () => {
  beforeEach(() => {
    open.mockClear()
    ;(globalThis as { window?: unknown }).window = { api: { terminal: { open } } }
  })

  it('keys the shell by the bottom-panel root and starts it in the worktree', async () => {
    const deps = {
      bottomRoot: '/proj', terminals: [], layoutRef: { current: null }, activePaneIdRef: { current: null },
      setTerminals: vi.fn(), setBottomTab: vi.fn(), setRunPanelOpen: vi.fn(), t: (k: string) => k
    }
    useNavigation(deps as never)
    await handlers.current!.openTerminalAt('/proj/wt/task')
    expect(open).toHaveBeenCalledWith('/proj', undefined, undefined, '/proj/wt/task')
  })
})
