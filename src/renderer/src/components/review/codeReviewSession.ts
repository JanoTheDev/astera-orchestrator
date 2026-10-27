// "AI code review": a chat session started with the review prompt of a PR or a branch diff. The session is a real CLI chat.
import type { OrchDoor } from '../../lib/orchDoor'
import { toast } from '../../lib/toast'
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import { openConsole } from '../shell/navigation'
import { codeReviewPrompt, codeReviewTitle, type ReviewTarget } from '../../../../core/review/reviewPrompt'

const errorOf = (r: { status: number; body: unknown }): string => String((r.body as { error?: unknown } | null)?.error ?? r.status)

/** Starts the review chat in `cwd` and hands its id to `open`. */
export async function startCodeReview(
  door: Pick<OrchDoor, 'command'>,
  { cwd, target }: { cwd: string; target: ReviewTarget },
  open: (sessionId: string) => void
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const made = await door.command('sessions-create', { kind: 'chat', cwd, title: codeReviewTitle(target), prompt: codeReviewPrompt(target) })
    const id = (made.body as { id?: unknown } | null)?.id
    if (made.status >= 400 || typeof id !== 'string') return { ok: false, error: errorOf(made) }
    open(id)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** The buttons' entry: starts the review, opens its tab, or toasts why not. */
export async function startCodeReviewWithToast(
  door: Pick<OrchDoor, 'command'>,
  input: { cwd: string; target: ReviewTarget },
  t: (key: MessageKey, params?: MessageParams) => string
): Promise<void> {
  const r = await startCodeReview(door, input, (id) => {
    // shortcut: same as askAboutTaskWithToast, the tab can arrive after the reply, so it is tried twice.
    setTimeout(() => openConsole(id), 300)
    setTimeout(() => openConsole(id), 1500)
  })
  if (!r.ok) toast.error(t('review.code.failed', { detail: r.error }))
}
