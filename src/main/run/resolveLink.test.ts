import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { agentDirOf, folderToOpen, resolveConsolePath, resolveExistingFile, resolveExistingPath } from './resolveLink'
import { absPath } from '../../core/testPaths'

const file = { isFile: () => true, isDirectory: () => false }
const dir = { isFile: () => false, isDirectory: () => true }
const allow = async (): Promise<void> => {}

describe('resolveConsolePath', () => {
  it('resolves a relative target against the cwd and reports a file', async () => {
    const cwd = absPath('proj')
    const stat = vi.fn(async () => file)
    const out = await resolveConsolePath({ cwd, target: 'src/a.ts', stat, assertAllowedPath: allow })
    expect(out).toBe(path.resolve(cwd, 'src/a.ts'))
    expect(stat).toHaveBeenCalledWith(path.resolve(cwd, 'src/a.ts'))
  })

  it('an absolute target is used as it is', async () => {
    const target = absPath('elsewhere', 'b.ts')
    const out = await resolveConsolePath({ cwd: absPath('proj'), target, stat: async () => file, assertAllowedPath: allow })
    expect(out).toBe(path.resolve(target))
  })

  // The guard runs first: a path outside the registered roots is refused before the disk is touched,
  // so the renderer cannot use this to learn what exists elsewhere
  it('a path the guard refuses is null and is never stat-ed', async () => {
    const stat = vi.fn(async () => file)
    const out = await resolveConsolePath({
      cwd: absPath('proj'),
      target: '../../secret.txt',
      stat,
      assertAllowedPath: async () => {
        throw new Error('outside')
      }
    })
    expect(out).toBeNull()
    expect(stat).not.toHaveBeenCalled()
  })

  it('a directory is null', async () => {
    expect(await resolveConsolePath({ cwd: absPath('proj'), target: 'src', stat: async () => dir, assertAllowedPath: allow })).toBeNull()
  })

  it('a missing file is null', async () => {
    const stat = async (): Promise<{ isFile(): boolean }> => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    expect(await resolveConsolePath({ cwd: absPath('proj'), target: 'gone.ts', stat, assertAllowedPath: allow })).toBeNull()
  })

  it('tries the source roots, in order, for a relative target the cwd does not have', async () => {
    const seen: string[] = []
    const stat = vi.fn(async (p: string) => {
      seen.push(p)
      if (p === path.resolve('/proj', 'src/main/java', 'com/anipen/App.java')) return { isFile: () => true }
      throw new Error('ENOENT')
    })
    const guard = vi.fn(async (_p: string) => undefined)
    await expect(resolveConsolePath({ cwd: '/proj', target: 'com/anipen/App.java', stat, assertAllowedPath: guard })).resolves.toBe(
      path.resolve('/proj', 'src/main/java', 'com/anipen/App.java')
    )
    expect(seen).toEqual([path.resolve('/proj', 'com/anipen/App.java'), path.resolve('/proj', 'src/main/java', 'com/anipen/App.java')])
    // The guard ran before each stat, on the same path
    expect(guard.mock.calls.map((c) => c[0])).toEqual(seen)
  })

  it('an absolute target is never tried under the roots', async () => {
    const stat = vi.fn(async () => { throw new Error('ENOENT') })
    const abs = path.resolve('/elsewhere/App.java')
    await expect(resolveConsolePath({ cwd: '/proj', target: abs, stat, assertAllowedPath: async () => undefined })).resolves.toBeNull()
    expect(stat).toHaveBeenCalledTimes(1)
  })

  it('a candidate the guard refuses is skipped without a stat, and the search goes on', async () => {
    const hit = path.resolve('/proj', 'src', 'App.java')
    const stat = vi.fn(async (p: string) => { if (p === hit) return { isFile: () => true }; throw new Error('ENOENT') })
    const guard = vi.fn(async (p: string) => { if (p === path.resolve('/proj', 'App.java')) throw new Error('outside') })
    await expect(resolveConsolePath({ cwd: '/proj', target: 'App.java', stat, assertAllowedPath: guard })).resolves.toBe(hit)
    expect(stat.mock.calls.map((c) => c[0])).not.toContain(path.resolve('/proj', 'App.java'))
  })

  it('answers null when nothing under the roots is a file either', async () => {
    const stat = vi.fn(async () => { throw new Error('ENOENT') })
    await expect(resolveConsolePath({ cwd: '/proj', target: 'Nope.java', stat, assertAllowedPath: async () => undefined })).resolves.toBeNull()
    expect(stat).toHaveBeenCalledTimes(1 + 5)
  })
})

// The session terminals' resolver (files.resolveLink). Narrower than the run console's in one way —
// no source roots, a target names one place — and wider in another: there is no path guard, because
// a session's agent writes wherever it was told to (a video pipeline's output folder is rarely a
// registered project), and this only ever answers "is there a regular file here".
// D2 (2026-10-14): a folder path in a terminal is a link too, when the terminal asks for folders. The SendUserFile row
// and the run console keep files only.
describe('resolveExistingPath', () => {
  const missing = async (): Promise<typeof file> => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  }

  it('answers a folder only when asked for folders', async () => {
    const cwd = absPath('proj')
    expect(await resolveExistingPath({ cwd, target: 'clips', stat: async () => dir, dirs: true })).toEqual({ path: path.resolve(cwd, 'clips'), dir: true })
    expect(await resolveExistingPath({ cwd, target: 'clips', stat: async () => dir, dirs: false })).toBeNull()
    expect(await resolveExistingPath({ cwd, target: 'a.png', stat: async () => file, dirs: true })).toEqual({ path: path.resolve(cwd, 'a.png') })
    expect(await resolveExistingPath({ cwd, target: 'gone', stat: missing, dirs: true })).toBeNull()
  })

  it('never answers a root, a bare separator or a path of dots alone', async () => {
    const cwd = absPath('proj', 'sub')
    // A drive is a root on Windows only: on macOS and Linux `C:\` names an entry in the folder, as any name does
    const drives = process.platform === 'win32' ? ['C:\\', 'C:/'] : []
    for (const target of ['/', '\\', ...drives, './', '../', '..\\..\\', '~/'])
      expect(await resolveExistingPath({ cwd, target, stat: async () => dir, dirs: true }), target).toBeNull()
  })

  it('refuses a UNC folder before the disk', async () => {
    const stat = vi.fn(async () => dir)
    expect(await resolveExistingPath({ cwd: absPath('proj'), target: '\\\\host\\share\\x', stat, dirs: true })).toBeNull()
    expect(stat).not.toHaveBeenCalled()
  })
})

// The system file manager opens a folder a link named outside the project, and only a folder: shell.openPath on a file
// would run it.
describe('folderToOpen', () => {
  it('answers an absolute folder', async () => {
    const p = absPath('elsewhere', 'specs')
    expect(await folderToOpen(p, async () => dir)).toBe(path.resolve(p))
  })

  it('refuses a file, a missing path, a relative path, a UNC path and anything not a string', async () => {
    expect(await folderToOpen(absPath('a', 'run.exe'), async () => file)).toBeNull()
    expect(
      await folderToOpen(absPath('gone'), async () => {
        throw new Error('ENOENT')
      })
    ).toBeNull()
    expect(await folderToOpen('relative/dir', async () => dir)).toBeNull()
    expect(await folderToOpen('\\\\host\\share', async () => dir)).toBeNull()
    expect(await folderToOpen(42, async () => dir)).toBeNull()
  })
})

describe('resolveExistingFile', () => {
  it('an absolute existing file is answered as it is', async () => {
    const target = absPath('elsewhere', 'clips', 'g1.mp4')
    const stat = vi.fn(async () => file)
    expect(await resolveExistingFile({ cwd: absPath('proj'), target, stat })).toBe(path.resolve(target))
    expect(stat).toHaveBeenCalledWith(path.resolve(target))
  })

  it('a relative target is resolved against the cwd', async () => {
    const cwd = absPath('proj')
    expect(await resolveExistingFile({ cwd, target: 'out/a.png', stat: async () => file })).toBe(path.resolve(cwd, 'out/a.png'))
  })

  it('a file outside the cwd is still a file — nothing is special about outside', async () => {
    const cwd = absPath('proj', 'sub')
    expect(await resolveExistingFile({ cwd, target: '../../other/b.mp4', stat: async () => file })).toBe(
      path.resolve(cwd, '../../other/b.mp4')
    )
  })

  it('a missing file is null', async () => {
    const stat = async (): Promise<{ isFile(): boolean }> => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    expect(await resolveExistingFile({ cwd: absPath('proj'), target: 'gone.mp4', stat })).toBeNull()
  })

  it('a directory is null', async () => {
    expect(await resolveExistingFile({ cwd: absPath('proj'), target: 'clips', stat: async () => dir })).toBeNull()
  })

  // No guessing: one candidate, one stat — unlike resolveConsolePath, no source roots are tried
  it('tries exactly one place', async () => {
    const stat = vi.fn(async () => { throw new Error('ENOENT') })
    await resolveExistingFile({ cwd: absPath('proj'), target: 'com/anipen/App.java', stat })
    expect(stat).toHaveBeenCalledTimes(1)
  })

  // A relative target with no real cwd would otherwise resolve against main's own working directory
  it('a relative target with no absolute cwd is null and touches nothing', async () => {
    const stat = vi.fn(async () => file)
    expect(await resolveExistingFile({ cwd: '', target: 'a.png', stat })).toBeNull()
    expect(await resolveExistingFile({ cwd: 'relative/dir', target: 'a.png', stat })).toBeNull()
    expect(stat).not.toHaveBeenCalled()
  })

  it('an empty target is null', async () => {
    const stat = vi.fn(async () => file)
    expect(await resolveExistingFile({ cwd: absPath('proj'), target: '', stat })).toBeNull()
    expect(stat).not.toHaveBeenCalled()
  })

  // This runs on hover. A stat of a UNC path makes Windows connect to that SMB host — offering the
  // user's NTLM credentials to whoever printed the path, and parking a threadpool thread on a host
  // that does not answer. Anything that starts with two separators (\\server, //server, \\?\, \\.\)
  // is refused before the disk, on every platform.
  it('a UNC, device or double-slash target is null and is never stat-ed', async () => {
    const stat = vi.fn(async () => file)
    for (const target of ['\\\\h\\s\\a.png', '//h/s/a.png', '\\\\?\\C:\\x.png', '\\\\.\\pipe\\x.png', '/\\h\\s\\a.png']) {
      expect(await resolveExistingFile({ cwd: absPath('proj'), target, stat }), target).toBeNull()
    }
    expect(stat).not.toHaveBeenCalled()
  })

  // The agent `cd`s inside its Bash tool, and Claude Code prints a SendUserFile path relative to that
  // directory, not to the session's cwd. The statusLine payload names it (agentDirOf).
  it("tries the agent's current directory first, then the session cwd", async () => {
    const cwd = absPath('ANIPEN', 'short-video')
    const currentDir = absPath('ANIPEN', 'short-video', 'video', 'EP01', 'prompts')
    const hit = path.resolve(currentDir, 'clips\\chk\\a.mp4')
    const seen: string[] = []
    const stat = vi.fn(async (p: string) => {
      seen.push(p)
      if (p === hit) return file
      throw new Error('ENOENT')
    })
    expect(await resolveExistingFile({ cwd, currentDir, target: 'clips\\chk\\a.mp4', stat })).toBe(hit)
    expect(seen).toEqual([hit])
  })

  it('falls back to the session cwd when the current directory does not have it', async () => {
    const cwd = absPath('proj')
    const currentDir = absPath('proj', 'sub')
    const atCwd = path.resolve(cwd, 'out/a.png')
    const seen: string[] = []
    const stat = vi.fn(async (p: string) => {
      seen.push(p)
      if (p === atCwd) return file
      throw new Error('ENOENT')
    })
    expect(await resolveExistingFile({ cwd, currentDir, target: 'out/a.png', stat })).toBe(atCwd)
    expect(seen).toEqual([path.resolve(currentDir, 'out/a.png'), atCwd])
  })

  it('a current directory that is the cwd is tried once, and none at all means cwd only', async () => {
    const cwd = absPath('proj')
    const stat = vi.fn(async () => { throw new Error('ENOENT') })
    await resolveExistingFile({ cwd, currentDir: cwd, target: 'a.png', stat })
    expect(stat).toHaveBeenCalledTimes(1)
    await resolveExistingFile({ cwd, currentDir: null, target: 'a.png', stat })
    expect(stat).toHaveBeenCalledTimes(2)
  })

  it('an absolute target is tried as it is, whatever the current directory', async () => {
    const target = absPath('elsewhere', 'b.mp4')
    const stat = vi.fn(async () => file)
    expect(await resolveExistingFile({ cwd: absPath('proj'), currentDir: absPath('proj', 'sub'), target, stat })).toBe(path.resolve(target))
    expect(stat).toHaveBeenCalledTimes(1)
  })

  it('a UNC or relative current directory is skipped without a stat, and the cwd is still tried', async () => {
    const cwd = absPath('proj')
    for (const currentDir of ['\\\\h\\share\\x', '//h/share/x', 'relative\\dir']) {
      const seen: string[] = []
      const stat = vi.fn(async (p: string) => {
        seen.push(p)
        throw new Error('ENOENT')
      })
      expect(await resolveExistingFile({ cwd, currentDir, target: 'a.png', stat }), currentDir).toBeNull()
      expect(seen, currentDir).toEqual([path.resolve(cwd, 'a.png')])
    }
  })

  it('a relative target under a UNC cwd is null and is never stat-ed', async () => {
    const stat = vi.fn(async () => file)
    for (const cwd of ['\\\\h\\share\\proj', '//h/share/proj']) {
      expect(await resolveExistingFile({ cwd, target: 'out/a.png', stat }), cwd).toBeNull()
    }
    expect(stat).not.toHaveBeenCalled()
  })
})

// The statusLine payload Claude Code hands the capture script, read back per session
// (StatusLineManager.read): workspace.current_dir is where the agent is now, cwd the fallback.
describe('agentDirOf', () => {
  it('prefers workspace.current_dir', () => {
    expect(agentDirOf({ cwd: '/a', workspace: { current_dir: '/a/b' } })).toBe('/a/b')
  })

  it('falls back to the payload cwd', () => {
    expect(agentDirOf({ cwd: '/a' })).toBe('/a')
    expect(agentDirOf({ cwd: '/a', workspace: { current_dir: 3 } })).toBe('/a')
  })

  it('a missing or corrupt payload names nothing', () => {
    for (const p of [null, undefined, 'x', 7, [], {}, { workspace: null }, { cwd: '' }]) expect(agentDirOf(p), JSON.stringify(p)).toBeNull()
  })
})
