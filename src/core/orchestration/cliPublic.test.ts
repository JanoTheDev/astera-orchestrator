import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicEvent, publicFor } from './cliPublic'
import * as pkg from '../../../packages/client/src/internal.js'

// The behaviour of publicFor is tested with its code in the SDK package (packages/client/src/shape.test.ts). The CLI
// and MCP call this module's publicFor, so it has to be that one.
describe('cliPublic re-exports the package', () => {
  it('publicEvent is the package one, and publicFor answers as the package one for anything but a page', () => {
    expect(publicEvent).toBe(pkg.publicEvent)
    const task = { id: 't1', title: 't', prompt: 'held back' }
    expect(publicFor('tasks-list', [task])).toEqual(pkg.publicFor('tasks-list', [task]))
    expect(publicFor('jobs-get', { id: 'j1', models: {} })).toEqual(pkg.publicFor('jobs-get', { id: 'j1', models: {} }))
  })

  it('a paged list read keeps its counts and shapes its rows', () => {
    const page = { tasks: [{ id: 't1', prompt: 'held back' }], total: 9, offset: 0, limit: 1 }
    expect(publicFor('tasks-list', page)).toEqual({ tasks: [{ id: 't1' }], total: 9, offset: 0, limit: 1 })
    const questions = { questions: [{ id: 'q1', reason: 'held back' }], total: 1, offset: 0, limit: null }
    expect(publicFor('questions-list', questions)).toEqual({ questions: [{ id: 'q1' }], total: 1, offset: 0, limit: null })
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

describe("T4: a worker's approval request", () => {
  it('passes whole, not shaped as the command it stands in for', () => {
    const body = { approvalRequested: true, questionId: 'msg_1', command: 'astera jobs archive --id job_1', wait: 'astera ask --resume msg_1 --json', message: 'm' }
    expect(publicFor('jobs-archive', body)).toEqual(body)
  })
})
