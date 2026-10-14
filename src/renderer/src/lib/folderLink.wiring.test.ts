// D2 (2026-10-14): the folder link's wiring, read from the source as the Host's composition tests read theirs. A
// terminal asks main for folders and hands a folder's click to the App; the App reveals or opens it; the explorer takes
// the reveal. Dropping any one of these leaves folders silently unlinked or the click doing nothing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const components = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components')
const read = (f: string): string => readFileSync(f, 'utf8')
const app = read(path.join(components, '..', 'App.tsx'))

describe('the folder link is wired', () => {
  it('session and project terminals ask main for folders and hand a folder to the App', () => {
    for (const f of ['TerminalView.tsx', 'TerminalBody.tsx']) {
      const src = read(path.join(components, f))
      expect(src, f).toMatch(/window\.api\.files\.resolveLink\([^)]*\{ dirs: true \}\)/)
      expect(src, f).toMatch(/onOpenFolder: \(path\) => onOpenFolderRef\.current\?\.\(path\)/)
    }
    expect(read(path.join(components, 'PaneGrid.tsx'))).toMatch(/onOpenFolder=\{onOpenFolder\}/)
    expect(read(path.join(components, 'BottomPanel.tsx'))).toMatch(/onOpenFolder=\{onOpenFolder\}/)
  })

  it('the App reveals a folder of its project in the explorer, and opens any other in the file manager', () => {
    expect(app.match(/onOpenFolder=\{openLinkedFolder\}/g)).toHaveLength(2)
    expect(app).toMatch(/revealFolder=\{explorerReveal\}/)
    const handler = app.slice(app.indexOf('const openLinkedFolder = '), app.indexOf('const openLinkedFolder = ') + 600)
    expect(handler).toMatch(/folderLinkAction\(folder, currentProjectRef\.current\)/)
    expect(handler).toMatch(/showExplorer\(\)/)
    expect(handler).toMatch(/window\.api\.files\.openFolder\(folder\)/)
  })

  it('the conversation view and the run console keep files only', () => {
    expect(read(path.join(components, 'conversation', 'ConversationPane.tsx'))).not.toMatch(/dirs: true/)
    expect(read(path.join(components, 'RunPanel.tsx'))).not.toMatch(/onOpenFolder/)
  })
})
