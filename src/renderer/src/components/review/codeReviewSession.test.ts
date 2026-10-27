import { describe, expect, it, vi } from 'vitest'
import { startCodeReview } from './codeReviewSession'
import { codeReviewPrompt } from '../../../../core/review/reviewPrompt'

const target = { kind: 'branch', base: 'main', head: 'feat/x' } as const
const doorOf = (reply: { status: number; body: unknown }) => ({ command: vi.fn(async () => reply) }) as never

describe('startCodeReview', () => {
  it('creates a chat session with cwd, title and prompt, then opens it', async () => {
    const door = doorOf({ status: 200, body: { id: 's1' } })
    const open = vi.fn()
    expect(await startCodeReview(door, { cwd: '/repo', target }, open)).toEqual({ ok: true })
    expect((door as { command: ReturnType<typeof vi.fn> }).command).toHaveBeenCalledWith('sessions-create', {
      kind: 'chat',
      cwd: '/repo',
      title: 'Review: feat/x',
      prompt: codeReviewPrompt(target)
    })
    expect(open).toHaveBeenCalledWith('s1')
  })
  it('reports an error status without opening', async () => {
    const open = vi.fn()
    expect(await startCodeReview(doorOf({ status: 500, body: { error: 'boom' } }), { cwd: '/r', target }, open)).toEqual({ ok: false, error: 'boom' })
    expect(open).not.toHaveBeenCalled()
  })
  it('reports a thrown error', async () => {
    const door = { command: vi.fn(async () => Promise.reject(new Error('down'))) } as never
    expect(await startCodeReview(door, { cwd: '/r', target }, vi.fn())).toEqual({ ok: false, error: 'down' })
  })
})
