import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MAX_ATTACHMENT_BYTES, saveClipboardFile } from './intakePaste'

const b64 = (s: string): string => Buffer.from(s).toString('base64')

describe('saveClipboardFile', () => {
  let userData = ''
  beforeEach(async () => {
    userData = await mkdtemp(path.join(os.tmpdir(), 'intake-paste-'))
  })
  afterEach(() => rm(userData, { recursive: true, force: true }))

  it('writes the bytes under <userData>/intake-paste/<uuid>/ and answers the absolute path', async () => {
    const file = await saveClipboardFile(userData, 'image.png', 'image/png', b64('png'))
    expect(path.isAbsolute(file)).toBe(true)
    const rel = path.relative(path.join(userData, 'intake-paste'), file).split(path.sep)
    expect(rel).toHaveLength(2)
    expect(rel[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(rel[1]).toMatch(/^image-\d{8}-\d{6}-\d+\.png$/)
    expect(await readFile(file, 'utf8')).toBe('png')
  })

  it('keeps two pastes of the same name apart (the intake refuses duplicate names)', async () => {
    const a = await saveClipboardFile(userData, 'image.png', 'image/png', b64('a'))
    const b = await saveClipboardFile(userData, 'image.png', 'image/png', b64('b'))
    expect(path.basename(a)).not.toBe(path.basename(b))
  })

  it('drops path separators and climbing parts from the name', async () => {
    for (const name of ['../../etc/passwd', '..\\..\\win.ini', '/abs/evil.txt']) {
      const file = await saveClipboardFile(userData, name, 'text/plain', b64('x'))
      expect(path.dirname(path.dirname(file))).toBe(path.join(userData, 'intake-paste'))
      expect(path.basename(file)).not.toMatch(/[\\/]|^\.\./)
    }
  })

  it('names a nameless paste after the clock', async () => {
    expect(path.basename(await saveClipboardFile(userData, '', 'image/jpeg', b64('j')))).toMatch(/^pasted-\d{8}-\d{6}-\d+\.jpg$/)
  })

  it('refuses a bad mime, wrong types, an empty payload and one over the cap', async () => {
    await expect(saveClipboardFile(userData, 'a.png', 'image/png; x=../', b64('x'))).rejects.toThrow('INVALID_MIME')
    await expect(saveClipboardFile(userData, 1, 'image/png', b64('x'))).rejects.toThrow('INVALID_ATTACHMENT')
    await expect(saveClipboardFile(userData, 'a.png', 'image/png', '')).rejects.toThrow('EMPTY_ATTACHMENT')
    const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64')
    await expect(saveClipboardFile(userData, 'a.png', 'image/png', big)).rejects.toThrow('ATTACHMENT_TOO_LARGE')
  })
})
