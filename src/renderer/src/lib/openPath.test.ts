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
  it('is how the explorer and a Markdown preview open a file', async () => {
    const { readFileSync } = await import('node:fs')
    const app = readFileSync(`${process.cwd()}/src/renderer/src/App.tsx`, 'utf8')
    expect(app).toMatch(/<FileExplorer\s+root=\{currentProject\}\s+onOpenFile=\{openFromExplorer\}/)
    expect(app).toContain('onOpenFile={openFromExplorer}\n            onSave=')
  })
})
