// The explorer and a Markdown preview open a file the way a terminal link does: an image or a video in the media viewer
// (after main resolves it, which is what lets the viewer load it), anything else in a file tab, where a binary file
// could only say it cannot be shown.
import { describe, it, expect } from 'vitest'
import { openPath } from './openPath'

const rig = (resolved: string | null) => {
  const calls: string[] = []
  return {
    calls,
    deps: {
      resolve: async (p: string) => (calls.push(`resolve ${p}`), resolved),
      openMedia: (p: string) => void calls.push(`media ${p}`),
      openFile: (p: string) => void calls.push(`file ${p}`)
    }
  }
}

describe('openPath', () => {
  it('opens an image or a video in the media viewer, on the path main resolved', async () => {
    for (const p of ['D:/work/shot.png', 'D:/work/clip.MP4']) {
      const h = rig(p)
      await openPath(p, h.deps)
      expect(h.calls).toEqual([`resolve ${p}`, `media ${p}`])
    }
  })

  it('opens any other file in a file tab without asking main', async () => {
    const h = rig(null)
    await openPath('D:/work/a.ts', h.deps)
    expect(h.calls).toEqual(['file D:/work/a.ts'])
  })

  it('falls back to a file tab when main does not resolve the media file', async () => {
    const h = rig(null)
    await openPath('D:/work/gone.png', h.deps)
    expect(h.calls).toEqual(['resolve D:/work/gone.png', 'file D:/work/gone.png'])
  })

  it('falls back to a file tab when resolving throws', async () => {
    const calls: string[] = []
    await openPath('D:/work/a.png', { resolve: async () => { throw new Error('ipc') }, openMedia: () => void calls.push('media'), openFile: (p) => void calls.push(`file ${p}`) })
    expect(calls).toEqual(['file D:/work/a.png'])
  })
})

describe('openPath wiring', () => {
  const read = async (f: string): Promise<string> => (await import('node:fs')).readFileSync(`${process.cwd()}/${f}`, 'utf8')
  // W9-A: App's body is in state/* and components/shell/* now; this is App.tsx and every file it was cut into.
  const readApp = async (): Promise<string> => (await import('../state/shellSource')).shellSource()

  it('is how the explorer and a Markdown preview open a file, admitting media through the project guard', async () => {
    const app = await readApp()
    expect(app).toMatch(/<FileExplorer\s+root=\{currentProject\}\s+onOpenFile=\{openProjectFile\}/)
    expect(app).toContain('onOpenFile={openProjectFile}\n            onSave=')
    expect(app).toMatch(/const openProjectFile = [\s\S]{0,400}window\.api\.files\.admitMedia\(/)
    expect(await read('src/main/ipc.ts')).toMatch(/ipcMain\.handle\('files\.admitMedia', [\s\S]{0,200}admitProjectMedia\(/)
    expect(await read('src/preload/index.ts')).toContain("admitMedia: invoke('files.admitMedia')")
  })

  // Final review I1: a media tab follows a rename, a move or an undo in the explorer, and goes with a delete.
  it('moves media tabs on a rename and closes them on a delete', async () => {
    const app = await readApp()
    expect(app).toMatch(/const handlePathRenamed = [\s\S]{0,600}mediaTabsUnder\(/)
    expect(app).toMatch(/const handlePathDeleted = [\s\S]{0,900}mediaTabsUnder\(/)
  })
})
