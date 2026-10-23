import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { APP_ID } from './appId'

describe('APP_ID', () => {
  it('matches electron-builder.yml appId', () => {
    const yml = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8')
    expect(/^appId:\s*(\S+)/m.exec(yml)?.[1]).toBe(APP_ID)
  })
})
