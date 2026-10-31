import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { slotHolder, takeHeavySlotByFile } from './heavyLock'

const node = { cmd: [process.execPath, '-e', 'process.stdin.resume()'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }

describe('takeHeavySlotByFile (Windows heavy slots without flock)', () => {
  it('holds a slot while its command runs, says busy when all are held, frees it on exit', async () => {
    const lock = join(mkdtempSync(join(tmpdir(), 'heavy-')), 'heavy.lock')
    const first = await takeHeavySlotByFile({ lock, slots: 1, ...node }, ['pipe', 'ignore', 'ignore'])
    expect(first).not.toBe('busy')
    expect(existsSync(`${lock}.owner`)).toBe(true)
    expect(await takeHeavySlotByFile({ lock, slots: 1, ...node }, ['pipe', 'ignore', 'ignore'])).toBe('busy')
    if (first === 'busy') return
    first.child.stdin!.end()
    await first.exited
    expect(existsSync(`${lock}.owner`)).toBe(false)
  })

  it('takes back a slot whose owner pid is gone', async () => {
    const lock = join(mkdtempSync(join(tmpdir(), 'heavy-')), 'heavy.lock')
    writeFileSync(`${lock}.owner`, '999999')
    const took = await takeHeavySlotByFile({ lock, slots: 1, ...node }, ['pipe', 'ignore', 'ignore'], () => false)
    expect(took).not.toBe('busy')
    if (took === 'busy') return
    took.child.stdin!.end()
    await took.exited
  })

  it('uses the second slot when the first is held', async () => {
    const lock = join(mkdtempSync(join(tmpdir(), 'heavy-')), 'heavy.lock')
    writeFileSync(`${lock}.owner`, String(process.pid))
    const took = await takeHeavySlotByFile({ lock, slots: 2, ...node }, ['pipe', 'ignore', 'ignore'])
    expect(took).not.toBe('busy')
    expect(existsSync(join(lock, '..', 'heavy.1.lock.owner'))).toBe(true)
    if (took === 'busy') return
    took.child.stdin!.end()
    await took.exited
  })

  it('names cat off Windows', () => {
    if (process.platform !== 'win32') expect(slotHolder().cmd).toEqual(['cat'])
    else expect(slotHolder().cmd[0]).toBe(process.execPath)
  })
})
