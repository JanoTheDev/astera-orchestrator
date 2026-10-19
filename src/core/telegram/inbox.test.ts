import { describe, expect, it, vi } from 'vitest'
import { RECONNECT_BASE_MS } from '../connections/backoff'
import { MAX_INJECT_CHARS } from '../connections/input'
import { TelegramInbox, TelegramInboxController, type TelegramInboxDeps } from './inbox'

const TOKEN = '123456:SECRET-token_value'
const CHAT = '42'
const ME = '777'
const NOW_MS = 1_700_000_000_000
const START = NOW_MS / 1000

type Handler = (body: Record<string, unknown>, signal: AbortSignal | null | undefined) => Promise<Response> | Response
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status })
const updates = (...u: unknown[]): Response => json(200, { ok: true, result: u })
/** Hangs until the request is aborted, like an idle long poll. */
const idle: Handler = (_b, signal) =>
  new Promise((_r, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))

const upd = (id: number, over: Record<string, unknown> = {}): unknown => ({
  update_id: id,
  message: {
    message_id: id,
    date: START + 10,
    text: 'go',
    chat: { id: 42 },
    from: { id: 777, is_bot: false },
    reply_to_message: { message_id: 11 },
    ...over
  }
})

function setup(handlers: Handler[], over: Partial<TelegramInboxDeps> = {}) {
  const calls: Record<string, unknown>[] = []
  const urls: string[] = []
  let i = 0
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push(body)
    urls.push(String(url))
    const h = handlers[Math.min(i++, handlers.length - 1)]
    return h(body, init?.signal)
  }) as typeof fetch
  const logs: string[] = []
  const written: Array<[string, string]> = []
  const notes: Array<[string, string]> = []
  const deps: TelegramInboxDeps = {
    botToken: TOKEN,
    chatId: CHAT,
    userId: () => ME,
    isOwnMessage: () => false,
    replyHint: () => 'HINT: reply to a session message',
    resolveSession: (target) => (target === '11' ? 'sess-1' : null),
    write: (id, data) => {
      written.push([id, data])
      return true
    },
    postNote: async (to, text) => {
      notes.push([to, text])
    },
    lang: () => 'en',
    log: (m) => logs.push(m),
    fetchFn,
    now: () => NOW_MS,
    ...over
  }
  return { inbox: new TelegramInbox(deps), calls, urls, logs, written, notes }
}

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

describe('TelegramInbox', () => {
  it('polls with the long-poll parameters, and advances the offset past each update', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => updates(upd(100), upd(101)), idle])
      h.inbox.start()
      await flush()
      expect(h.calls[0]).toEqual({ timeout: 50, allowed_updates: ['message'] })
      expect(h.calls[1]).toEqual({ timeout: 50, allowed_updates: ['message'], offset: 102 })
      expect(h.urls[0]).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`)
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('injects an accepted reply into its session', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => updates(upd(100, { text: 'hello' })), idle])
      h.inbox.start()
      await flush()
      expect(h.written[0]).toEqual(['sess-1', expect.stringContaining('hello')])
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores messages from another chat or user, bots, and ones older than the start', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([
        () =>
          updates(
            upd(100, { chat: { id: 43 } }),
            upd(101, { from: { id: 1, is_bot: false } }),
            upd(102, { from: { id: 777, is_bot: true } }),
            upd(103, { date: START - 60 })
          ),
        idle
      ])
      h.inbox.start()
      await flush()
      expect(h.written).toEqual([])
      expect(h.notes).toEqual([])
      expect(h.logs.join('\n')).not.toContain('stale')
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('blocks every reply while no user id is configured', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => updates(upd(100)), idle], { userId: () => null })
      h.inbox.start()
      await flush()
      expect(h.written).toEqual([])
      expect(h.logs.join('\n')).toContain('ignored(user-id-unset)')
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers a message that is not a reply with the injected hint, under the user message', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => updates(upd(100, { reply_to_message: undefined })), idle])
      h.inbox.start()
      await flush()
      expect(h.notes).toEqual([['100', 'HINT: reply to a session message']])
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('tells the owner when a reply points at an ended or unknown session', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => updates(upd(100, { reply_to_message: { message_id: 999 } })), idle])
      h.inbox.start()
      await flush()
      expect(h.notes).toEqual([['999', expect.stringContaining('ended')]])
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects an over-long reply with a note', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => updates(upd(100, { text: 'x'.repeat(MAX_INJECT_CHARS + 1) })), idle])
      h.inbox.start()
      await flush()
      expect(h.written).toEqual([])
      expect(h.notes[0][0]).toBe('100')
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops echoes of its own messages', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => updates(upd(100)), idle], { isOwnMessage: (id) => id === '100' })
      h.inbox.start()
      await flush()
      expect(h.written).toEqual([])
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop() ends a pending poll at once', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      let aborted = false
      const h = setup([
        (_b, signal) => {
          signal?.addEventListener('abort', () => (aborted = true))
          return idle(_b, signal)
        }
      ])
      h.inbox.start()
      await flush()
      await h.inbox.stop()
      expect(aborted).toBe(true)
      expect(h.calls).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(h.calls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop() also ends a backoff wait', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => json(500, { ok: false, error_code: 500 })])
      h.inbox.start()
      await flush()
      await h.inbox.stop()
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(h.calls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('halts on 401 and never polls again', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => json(401, { ok: false, error_code: 401, description: 'Unauthorized' })])
      h.inbox.start()
      await flush()
      expect(h.inbox.halted()).toBe(true)
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(h.calls).toHaveLength(1)
      expect(h.logs.join('\n')).toContain('status=401')
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('halts on 404 (a token that does not exist)', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => json(404, { ok: false, error_code: 404, description: 'Not Found' })])
      h.inbox.start()
      await flush()
      expect(h.inbox.halted()).toBe(true)
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs a 409 conflict and backs off, then recovers', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => json(409, { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' }), idle])
      h.inbox.start()
      await flush()
      expect(h.inbox.halted()).toBe(false)
      expect(h.logs.join('\n')).toContain('another client polls')
      expect(h.calls).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
      expect(h.calls).toHaveLength(2)
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('doubles the wait after each failure and honours a longer retry_after', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([
        () => json(500, { ok: false }),
        () => json(500, { ok: false }),
        () => json(429, { ok: false, error_code: 429, parameters: { retry_after: 30 } }),
        idle
      ])
      h.inbox.start()
      await flush()
      await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
      expect(h.calls).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(2 * RECONNECT_BASE_MS)
      expect(h.calls).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(29_000)
      expect(h.calls).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(h.calls).toHaveLength(4)
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never logs the token, even for a network error that carries the URL', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const leaky = Object.assign(new Error(`failed https://api.telegram.org/bot${TOKEN}/getUpdates`), { name: 'FetchError' })
      const h = setup([
        () => {
          throw leaky
        },
        () => json(401, { ok: false, error_code: 401, description: `bad ${TOKEN}` })
      ])
      h.inbox.start()
      await flush()
      await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
      expect(h.logs.length).toBeGreaterThan(1)
      expect(h.logs.join('\n')).not.toContain('SECRET')
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps polling when routing one reply throws', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = setup([() => updates(upd(100), upd(101)), idle], {
        write: () => {
          throw new Error('pty gone')
        }
      })
      h.inbox.start()
      await flush()
      expect(h.calls).toHaveLength(2)
      await h.inbox.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('TelegramInboxController', () => {
  function ctl() {
    const inboxes: string[] = []
    let user: (() => string | null) | null = null
    const polls: Array<{ token: string }> = []
    const fetchFn = (async (url: unknown, init?: RequestInit) => {
      polls.push({ token: String(url).split('/bot')[1].split('/')[0] })
      return idle(JSON.parse(String(init?.body)), init?.signal)
    }) as typeof fetch
    const c = new TelegramInboxController({
      isQuitting: () => false,
      makeDeps: (u) => {
        user = u
        inboxes.push('made')
        return {
          isOwnMessage: () => false,
          replyHint: () => 'hint',
          resolveSession: () => null,
          write: () => true,
          postNote: async () => {},
          lang: () => 'en',
          log: () => {},
          fetchFn
        }
      }
    })
    return { c, inboxes, polls, user: () => user!() }
  }

  it('starts one poller per token + chat and rebuilds only when either changes', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = ctl()
      await h.c.apply({ botToken: 'a', chatId: '1', userId: '9' })
      await flush()
      await h.c.apply({ botToken: 'a', chatId: '1', userId: '9' })
      expect(h.inboxes).toHaveLength(1)
      await h.c.apply({ botToken: 'a', chatId: '2', userId: '9' })
      expect(h.inboxes).toHaveLength(2)
      await h.c.apply({ botToken: 'b', chatId: '2', userId: '9' })
      expect(h.inboxes).toHaveLength(3)
      await h.c.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes a changed user id to the live poller without a restart', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = ctl()
      await h.c.apply({ botToken: 'a', chatId: '1', userId: '9' })
      expect(h.user()).toBe('9')
      await h.c.apply({ botToken: 'a', chatId: '1', userId: null })
      expect(h.inboxes).toHaveLength(1)
      expect(h.user()).toBeNull()
      await h.c.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the poller when the token or chat is cleared, and stop() never rejects', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      const h = ctl()
      await h.c.apply({ botToken: 'a', chatId: '1', userId: '9' })
      await flush()
      await h.c.apply({ botToken: null, chatId: '1', userId: '9' })
      const n = h.polls.length
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(h.polls).toHaveLength(n)
      await expect(h.c.stop()).resolves.toBeUndefined()
      await expect(h.c.stop()).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a halted poller when the config is applied again', async () => {
    vi.useFakeTimers({ now: NOW_MS })
    try {
      let n = 0
      const fetchFn = (async (_u: unknown, init?: RequestInit) =>
        ++n === 1 ? json(401, { ok: false, error_code: 401 }) : idle({}, init?.signal)) as typeof fetch
      const c = new TelegramInboxController({
        isQuitting: () => false,
        makeDeps: () => ({ isOwnMessage: () => false, replyHint: () => '', resolveSession: () => null, write: () => true, postNote: async () => {}, lang: () => 'en', log: () => {}, fetchFn })
      })
      await c.apply({ botToken: 'a', chatId: '1', userId: '9' })
      await flush()
      await c.apply({ botToken: 'a', chatId: '1', userId: '9' })
      await flush()
      expect(n).toBe(2)
      await c.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
