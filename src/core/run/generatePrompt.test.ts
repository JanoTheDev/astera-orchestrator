import { describe, expect, it } from 'vitest'
import { buildGeneratePrompt } from './generatePrompt'

describe('buildGeneratePrompt', () => {
  it('names the project path in the save command', () => {
    const p = buildGeneratePrompt({ projectPath: '/work/my app', existingNames: [] })
    expect(p).toContain('/work/my app')
    expect(p).toContain('astera run-configs add --project')
  })

  it('lists the existing configuration names so the agent does not repeat them', () => {
    const p = buildGeneratePrompt({ projectPath: '/p', existingNames: ['Unit tests', 'dev'] })
    expect(p).toContain('"Unit tests"')
    expect(p).toContain('"dev"')
  })

  it('says so when there are none yet', () => {
    expect(buildGeneratePrompt({ projectPath: '/p', existingNames: [] })).toContain('none yet')
  })

  it('tells the agent what to read, to save only through the CLI, and to leave project files alone', () => {
    const p = buildGeneratePrompt({ projectPath: '/p', existingNames: [] })
    for (const word of ['package.json', 'Makefile', 'CI workflows', 'test setup']) expect(p).toContain(word)
    expect(p).toContain('Do not edit, create or delete any file in the project')
  })
})
