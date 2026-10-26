import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyWorkspaceStore, readWorkspaceStore, slotId, withSlot, writeWorkspaceStore } from './store'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'discord-ws-'))
  file = join(dir, 'discord-workspace.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('workspace store', () => {
  it('starts empty for the guild when the file is missing', async () => {
    expect(await readWorkspaceStore(file, 'g1')).toEqual(emptyWorkspaceStore('g1'))
  })

  it('round-trips what it wrote', async () => {
    const s = withSlot(
      withSlot(emptyWorkspaceStore('g1'), 'cat:astera', '10', 'Astera'),
      'ch:plan:job_1',
      '11',
      'fix-login'
    )
    await writeWorkspaceStore(file, s)
    const back = (await readWorkspaceStore(file, 'g1'))!
    expect(back).toEqual(s)
    expect(slotId(back, 'ch:plan:job_1')).toBe('11')
    expect(back.names['11']).toBe('fix-login')
  })

  it('ignores a store written for another guild', async () => {
    await writeWorkspaceStore(file, withSlot(emptyWorkspaceStore('old'), 'cat:astera', '10', 'Astera'))
    expect(await readWorkspaceStore(file, 'g1')).toEqual(emptyWorkspaceStore('g1'))
  })

  it('starts empty on a damaged file and keeps its bytes beside it', async () => {
    await writeFile(file, '{not json', 'utf8')
    expect(await readWorkspaceStore(file, 'g1')).toEqual(emptyWorkspaceStore('g1'))
    expect(await readFile(`${file}.bak`, 'utf8')).toBe('{not json')
  })

  it('fills fields an older file lacks', async () => {
    await writeFile(file, JSON.stringify({ guildId: 'g1', categories: { astera: '10' } }), 'utf8')
    const s = (await readWorkspaceStore(file, 'g1'))!
    expect(slotId(s, 'cat:astera')).toBe('10')
    expect(s.channels.plans).toEqual({})
    expect(s.categories.projects).toEqual({})
  })

  it('withSlot with a null id forgets the slot and its name', () => {
    const s = withSlot(emptyWorkspaceStore('g1'), 'cat:project:p1', '20', 'Web')
    const gone = withSlot(s, 'cat:project:p1', null)
    expect(slotId(gone, 'cat:project:p1')).toBeNull()
    expect(gone.names['20']).toBeUndefined()
    expect(slotId(s, 'cat:project:p1')).toBe('20') // the input is not changed
  })
})
