import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { INTAKE_FILE_MAX_BYTES, copyIntakeFiles, inputsDirOf } from './intakeFiles'

describe('copyIntakeFiles', () => {
  let tmp: string
  let profile: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'intake-'))
    profile = path.join(tmp, 'profile')
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("copies each file into plans/<jobId>/inputs beside the Job's plan.md", async () => {
    await fs.writeFile(path.join(tmp, 'spec.pdf'), '%PDF-1.4')
    const r = await copyIntakeFiles(profile, 'job_1', [path.join(tmp, 'spec.pdf')])
    expect(r).toEqual({ dir: path.join(profile, 'plans', 'job_1', 'inputs'), names: ['spec.pdf'] })
    expect(await fs.readFile(path.join(r.dir, 'spec.pdf'), 'utf8')).toBe('%PDF-1.4')
  })

  it('with no files only creates the folder (for an audit)', async () => {
    const r = await copyIntakeFiles(profile, 'job_2', [])
    expect((await fs.stat(r.dir)).isDirectory()).toBe(true)
  })

  it('refuses a folder, a missing or relative path, a file over 30 MB and two of one name, copying nothing', async () => {
    const big = path.join(tmp, 'big.bin')
    await fs.writeFile(big, '')
    await fs.truncate(big, INTAKE_FILE_MAX_BYTES + 1)
    await fs.mkdir(path.join(tmp, 'a'))
    await fs.writeFile(path.join(tmp, 'a', 'x.md'), 'a')
    await fs.writeFile(path.join(tmp, 'x.md'), 'b')
    const cases: [string[], RegExp][] = [
      [[tmp], /not a regular file/],
      [[path.join(tmp, 'nope.pdf')], /no such file/],
      [['spec.pdf'], /absolute path/],
      [[big], /larger than 30 MB/],
      [[path.join(tmp, 'x.md'), path.join(tmp, 'a', 'x.md')], /two attachments are named x\.md/]
    ]
    for (const [files, error] of cases) await expect(copyIntakeFiles(profile, 'job_3', files)).rejects.toThrow(error)
    await expect(fs.stat(inputsDirOf(profile, 'job_3'))).rejects.toThrow()
  })
})
