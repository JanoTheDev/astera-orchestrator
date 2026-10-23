import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendTo, list, MAX_OWNER_BYTES, OWNER_HEADING, profileDirOfSpecs, read, reset, write } from './ownerInstructions'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'owner-instr-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('appendTo', () => {
  it('returns the prompt untouched without text', () => {
    expect(appendTo('built\n', undefined)).toBe('built\n')
    expect(appendTo('built\n', '')).toBe('built\n')
    expect(appendTo('built\n', ' \n ')).toBe('built\n')
  })
  it('puts a headed block at the end', () => {
    const out = appendTo('built\n', 'Be brief.\n')
    expect(out.startsWith('built\n')).toBe(true)
    expect(out.endsWith(`## ${OWNER_HEADING}\n\nBe brief.\n`)).toBe(true)
  })
})

describe('write / read / list / reset', () => {
  it('round-trips a role and lists it', async () => {
    expect(await write(dir, 'worker', 'Use tabs.')).toEqual({ ok: true })
    expect(await read(dir, 'worker')).toBe('Use tabs.')
    expect(await read(dir, 'planner')).toBe('')
    const l = await list(dir)
    expect(l.map((i) => i.role)).toEqual(['session', 'planner', 'coordinator', 'worker', 'reviewer'])
    expect(l.find((i) => i.role === 'worker')).toEqual({ role: 'worker', bytes: 9, set: true })
    expect(l.find((i) => i.role === 'session')?.set).toBe(false)
    expect(readdirSync(path.join(dir, 'prompts'))).toEqual(['worker.md'])
  })
  it('rejects an unknown role and text over the cap, keeping the old text', async () => {
    await write(dir, 'worker', 'keep')
    expect(await write(dir, 'boss', 'x')).toEqual({ ok: false, error: 'invalid-role' })
    expect(await write(dir, 'worker', 'x'.repeat(MAX_OWNER_BYTES + 1))).toEqual({ ok: false, error: 'too-long', max: MAX_OWNER_BYTES })
    expect(await write(dir, 'worker', 'é'.repeat(MAX_OWNER_BYTES / 2 + 1))).toMatchObject({ error: 'too-long' })
    expect(await write(dir, 'worker', 'x'.repeat(MAX_OWNER_BYTES))).toEqual({ ok: true })
    expect(await write(dir, 'worker', 5)).toEqual({ ok: false, error: 'invalid-text' })
  })
  it('blank text and reset remove the file', async () => {
    await write(dir, 'reviewer', 'a')
    expect(await write(dir, 'reviewer', '  ')).toEqual({ ok: true })
    expect(await read(dir, 'reviewer')).toBe('')
    await write(dir, 'reviewer', 'a')
    expect(await reset(dir, 'reviewer')).toEqual({ ok: true })
    expect(await read(dir, 'reviewer')).toBe('')
    expect(await reset(dir, 'nope')).toEqual({ ok: false, error: 'invalid-role' })
  })
  it('read with no profile folder adds nothing', async () => {
    expect(await read(undefined, 'worker')).toBe('')
  })
})

it('profileDirOfSpecs strips orch/specs', () => {
  expect(profileDirOfSpecs(path.join('/p', 'orch', 'specs'))).toBe('/p')
})
