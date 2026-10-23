import { describe, expect, it } from 'vitest'
import { getAdvancedMode, resetAdvancedMode, setAdvancedMode } from '../../state/useAdvancedMode'
import { anchorRevealGroup } from './settingsAnchor'

describe('anchorRevealGroup', () => {
  it('an advanced row reveals its own group', () => {
    expect(anchorRevealGroup('maxWorkers')).toBe('agents')
    expect(anchorRevealGroup('workUnit')).toBe('advanced')
  })
  it('a basic row reveals nothing', () => {
    expect(anchorRevealGroup('theme')).toBeNull()
  })
  it('an unknown anchor reveals nothing', () => {
    expect(anchorRevealGroup('noSuchRow')).toBeNull()
  })
  it('leaves Advanced mode as it was', () => {
    resetAdvancedMode()
    setAdvancedMode(false)
    anchorRevealGroup('maxWorkers')
    expect(getAdvancedMode()).toBe(false)
    setAdvancedMode(true)
    anchorRevealGroup('theme')
    expect(getAdvancedMode()).toBe(true)
    resetAdvancedMode()
  })
})
