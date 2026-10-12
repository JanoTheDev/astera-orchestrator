// The explorer and a Markdown preview open an image or a video in the media viewer, which loads only files on the
// media allowlist. They admit a file through the project guard (not files.resolveLink, which refuses UNC paths and
// admits anything the renderer names): a file in a project the person opened, UNC and \\wsl$ projects included, and
// nothing outside one (final review of the explorer opening media, minors 2 and 3).
import { describe, it, expect } from 'vitest'
import { admitProjectMedia } from './admit'
import { createMediaAllowlist } from './allowlist'

const rig = (o: { allowed?: boolean; kind?: 'file' | 'dir' | 'none' } = {}) => {
  const allowlist = createMediaAllowlist('win32')
  return {
    allowlist,
    deps: {
      assertAllowedPath: async (p: string) => {
        if (o.allowed === false) throw new Error('not in a project')
        return p
      },
      stat: async () => {
        if (o.kind === 'none') throw new Error('ENOENT')
        return { isFile: () => o.kind !== 'dir' }
      },
      allowlist
    }
  }
}

describe('admitProjectMedia', () => {
  it('admits an image or a video in a project and answers its path', async () => {
    const h = rig()
    expect(await admitProjectMedia('\\\\server\\share\\proj\\shot.png', h.deps)).toEqual({ path: '\\\\server\\share\\proj\\shot.png' })
    expect(h.allowlist.has('\\\\server\\share\\proj\\shot.png')).toBe(true)
  })

  it('admits nothing outside a project, nothing that is not media, and no folder or missing file', async () => {
    for (const [p, o] of [
      ['D:/outside/a.png', { allowed: false }],
      ['D:/proj/a.ts', {}],
      ['D:/proj/dir.png', { kind: 'dir' }],
      ['D:/proj/gone.png', { kind: 'none' }]
    ] as const) {
      const h = rig(o)
      expect(await admitProjectMedia(p, h.deps), p).toBeNull()
      expect(h.allowlist.has(p), p).toBe(false)
    }
  })

  it('refuses what is not a path', async () => {
    expect(await admitProjectMedia(42 as unknown as string, rig().deps)).toBeNull()
    expect(await admitProjectMedia('relative/a.png', rig().deps)).toBeNull()
  })
})
