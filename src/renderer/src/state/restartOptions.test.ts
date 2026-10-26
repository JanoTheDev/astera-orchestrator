import { describe, expect, it } from 'vitest'
import type { SessionInfo } from '../../../core/types'
import { chainOf, restartOptionsOf } from './restartOptions'

const terminal: SessionInfo = {
  id: 'old',
  accountId: 'a1',
  cwd: '/repo',
  status: 'exited',
  title: 'repo',
  model: 'opus',
  effort: 'high',
  rollAccountIds: ['a1', 'a2'],
  rollPrompt: 'carry on',
  bypassPermissions: true,
  slackNotify: false
}
const transcript = { sessionId: 'cli-1', transcriptPath: '/cfg/projects/repo/cli-1.jsonl' }

describe('restartOptionsOf', () => {
  it('resumes a terminal session on its CLI conversation and keeps its model, effort and chain', () => {
    const o = restartOptionsOf(terminal, 'resume', transcript)
    expect(o).toMatchObject({
      resumeSessionId: 'cli-1',
      resumeTranscriptPath: transcript.transcriptPath,
      model: 'opus',
      effort: 'high',
      accountIds: ['a1', 'a2'],
      roll: true,
      rollPrompt: 'carry on',
      bypassPermissions: true,
      replacesSessionId: 'old',
      cwd: '/repo',
      saveDefault: false
    })
    expect(o.resumeThreadId).toBeUndefined()
  })

  it('falls back to the id the session was itself resumed from when no transcript was found', () => {
    expect(restartOptionsOf({ ...terminal, resumeSessionId: 'cli-0' }, 'resume', null).resumeSessionId).toBe('cli-0')
  })

  it('starts fresh when there is no resumable id, still on the same model and effort', () => {
    const o = restartOptionsOf(terminal, 'resume', null)
    expect(o.resumeSessionId).toBeUndefined()
    expect(o.resumeTranscriptPath).toBeUndefined()
    expect(o).toMatchObject({ model: 'opus', effort: 'high' })
  })

  it('starts fresh when asked to, even with a resumable id', () => {
    const o = restartOptionsOf({ ...terminal, resumeSessionId: 'cli-0' }, 'fresh', transcript)
    expect(o.resumeSessionId).toBeUndefined()
    expect(o.resumeTranscriptPath).toBeUndefined()
    expect(o.model).toBe('opus')
  })

  it('resumes a chat session on its thread', () => {
    const o = restartOptionsOf({ ...terminal, kind: 'chat', threadId: 'th-1', model: undefined, effort: undefined }, 'resume', null)
    expect(o).toMatchObject({ kind: 'chat', resumeThreadId: 'th-1' })
    expect(o.resumeSessionId).toBeUndefined()
    expect('model' in o).toBe(false)
  })

  it('starts a chat session fresh when it never got a thread', () => {
    expect(restartOptionsOf({ ...terminal, kind: 'chat' }, 'resume', null).resumeThreadId).toBeUndefined()
  })
})

describe('chainOf', () => {
  it('puts the account first and rolls only with a chain', () => {
    expect(chainOf('a2', ['a1', 'a2'])).toEqual({ accountIds: ['a2', 'a1'], roll: true })
    expect(chainOf('a1', undefined)).toEqual({ accountIds: ['a1'], roll: false })
  })
})
