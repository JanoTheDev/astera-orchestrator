import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicEvent, publicFor } from './cliPublic'
import * as pkg from '../../../packages/client/src/index.js'

// The behaviour of publicFor is tested with its code in the SDK package (packages/client/src/shape.test.ts). The CLI
// and MCP call this module's publicFor, so it has to be that one.
describe('cliPublic re-exports the package', () => {
  it('publicFor and publicEvent are the package ones', () => {
    expect(publicFor).toBe(pkg.publicFor)
    expect(publicEvent).toBe(pkg.publicEvent)
  })
})

// **core 는 cli 도 main 도 가져오지 않는다.** 타입만 가져와도 그 줄이 값 가져오기로 바뀌는 날 core 가
// 앱 쪽 모듈을 통째로 끌고 온다 — skills 의 답 타입은 그래서 core 에 있다(./skills).
describe('cliPublic 의 가져오기', () => {
  it('src/cli 와 src/main 에서 아무것도 가져오지 않는다', () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'cliPublic.ts'), 'utf8')
    expect(src).not.toMatch(/from '\.\.\/\.\.\/(cli|main)\//)
  })
})
