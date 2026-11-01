import { describe, expect, it, vi } from 'vitest'
import { installUpdate } from './installUpdate'

describe('installUpdate', () => {
  it('installs silently and runs the app after: quitAndInstall(true, true)', () => {
    const updater = { quitAndInstall: vi.fn() }
    installUpdate(updater)
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
})
