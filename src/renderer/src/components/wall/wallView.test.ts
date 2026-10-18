import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAGE } from '../../../../core/ui/pages'
import { getWallView, setWallView } from './wallView'
import { claimTerminal, registerDockable } from './consoleDock'

describe('Agents is the default page', () => {
  it('the app opens on Agents, and the Agents page on the wall', () => {
    expect(DEFAULT_PAGE).toBe('agents')
    expect(getWallView()).toEqual({ kind: 'wall' })
  })
  it('a console opens full size, Back to all returns to the wall', () => {
    setWallView({ kind: 'console', sessionId: 's1' })
    expect(getWallView()).toEqual({ kind: 'console', sessionId: 's1' })
    setWallView({ kind: 'wall' })
    expect(getWallView()).toEqual({ kind: 'wall' })
  })
})

describe('consoleDock: a tile borrows the one xterm a session has', () => {
  const anchor = (): HTMLElement => ({}) as HTMLElement
  it('shows into the tile, and home on release; a claim before the terminal mounts is honoured when it does', () => {
    const d = { show: vi.fn(), home: vi.fn(), focus: vi.fn() }
    const a = anchor()
    const release = claimTerminal('x1', a)
    const off = registerDockable('x1', d)
    expect(d.show).toHaveBeenCalledWith(a)
    release()
    expect(d.home).toHaveBeenCalledTimes(1)
    off()
  })
  it("a later claim takes it over, and the earlier one's release then does nothing", () => {
    const d = { show: vi.fn(), home: vi.fn(), focus: vi.fn() }
    const off = registerDockable('x2', d)
    const first = claimTerminal('x2', anchor())
    const second = claimTerminal('x2', anchor())
    first()
    expect(d.home).not.toHaveBeenCalled()
    second()
    expect(d.home).toHaveBeenCalledTimes(1)
    off()
  })
})
