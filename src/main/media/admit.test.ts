// The explorer and a Markdown preview open an image or a video in the media viewer, which loads only files on the
// media allowlist. They admit a file through the project guard (not files.resolveLink, which refuses UNC paths and
// admits anything the renderer names): a file in a project the person opened, UNC and \\wsl$ projects included, and
// nothing outside one (final review of the explorer opening media, minors 2 and 3).
import { describe, it, expect } from 'vitest'
import { admitProjectMedia } from './admit'
import { createMediaAllowlist } from './allowlist'

/** Absolute paths on the platform the test runs on: a share on Windows (what files.resolveLink refused), a mount
 *  elsewhere. */
const win = process.platform === 'win32'
const SHARED = win ? '\\\\server\\share\\proj\\shot.png' : '/srv/share/proj/shot.png'
const inProject = (name: string): string => (win ? `D:\\proj\\${name}` : `/home/me/proj/${name}`)

const rig = (o: { allowed?: boolean; kind?: 'file' | 'dir' | 'none' } = {}) => {
  const allowlist = createMediaAllowlist()
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
    expect(await admitProjectMedia(SHARED, h.deps)).toEqual({ path: SHARED })
    expect(h.allowlist.has(SHARED)).toBe(true)
  })

  it('admits nothing outside a project, nothing that is not media, and no folder or missing file', async () => {
    for (const [p, o] of [
      [inProject('a.png'), { allowed: false }],
      [inProject('a.ts'), {}],
      [inProject('dir.png'), { kind: 'dir' }],
      [inProject('gone.png'), { kind: 'none' }]
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
