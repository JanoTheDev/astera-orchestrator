import { describe, expect, it } from 'vitest'
import { objectiveItemsOf } from './objectiveItems'

describe('objectiveItemsOf', () => {
  it('reads top-level numbered items by their own numbers, nested lines belonging to the item above', () => {
    const objective = [
      'Fix the follow-up items:',
      '',
      '3. The owner cannot fix a running plan',
      '   - task-update --deps is refused',
      '   1. even from an Astera tab',
      '6) The planner drops part of the objective',
      '12. Untitled plans show their prompt'
    ].join('\n')
    expect(objectiveItemsOf(objective)).toEqual([
      { n: 3, text: 'The owner cannot fix a running plan' },
      { n: 6, text: 'The planner drops part of the objective' },
      { n: 12, text: 'Untitled plans show their prompt' }
    ])
  })
  it('numbers bullets 1, 2, 3 in order when there are no numbered items', () => {
    expect(objectiveItemsOf('Do these:\n- first thing\n  * nested detail\n* second thing\n• third thing')).toEqual([
      { n: 1, text: 'first thing' },
      { n: 2, text: 'second thing' },
      { n: 3, text: 'third thing' }
    ])
  })
  it('an objective with numbered items reads those only, its bullets are notes', () => {
    expect(objectiveItemsOf('1. one\n2. two\n- a note')).toEqual([
      { n: 1, text: 'one' },
      { n: 2, text: 'two' }
    ])
  })
  it('returns [] for an objective with no list, and ignores lists in code fences', () => {
    expect(objectiveItemsOf('Add dark mode to the settings page. Make it follow the system theme.')).toEqual([])
    expect(objectiveItemsOf('Run this:\n```\n1. not an item\n- nor this\n```\ndone')).toEqual([])
    expect(objectiveItemsOf('---\nA rule above, then text')).toEqual([])
  })
})
