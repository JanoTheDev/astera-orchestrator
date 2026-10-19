// W9-D: this is also the session search (W3-C): text that finds a session, plan or Task is a search, a sentence is a
// command (boxMode.ts). One box, one key.
// W3-B command bar: a conversation with the coordinator (SPEC §8, §4). Typed or spoken text becomes one intent (the
// fast path, else the coordinator role model), the intent's names become exact ids or a question, and only then does
// anything run: `read` at once, `act` on Run, `confirm` through a dialog (core/intents/safety.ts).
import { useEffect, useMemo, useRef, useState } from 'react'
import { MicIcon, X } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import type { Intent } from '../../../../core/intents/types'
import type { Pins } from '../../../../core/intents/resolve'
import { fastParse } from '../../../../core/intents/fastPath'
import { mayStart, SAFETY, type Trigger } from '../../../../core/intents/safety'
import { parsePrompt } from '../../../../core/intents/prompt'
import { planStatus } from '../../../../core/intents/summary'
import { planSessions, type WorkspaceData, type WorkspaceProject } from '../../state/workspaceTree'
import { useAttention } from '../../state/useAttention'
import { openConsole, openPlan } from '../shell/navigation'
import type { ActionUi } from '../../lib/jobActions'
import { isConfirmOpen } from '../../lib/confirm'
import { armBarClose } from './barClose'
import { boxHits, type BoxHit } from './boxHits'
import { boxModeOf } from './boxMode'
import { boxSourceOf } from './boxSource'
import { directoryOf } from './directory'
import { execute, resolveIntent, type ExecDeps, type Line, type Resolution } from './execute'
import { whisperSpeech } from './speech'
import './command.css'

interface Entry {
  who: 'you' | 'coordinator'
  lines: Line[]
}

interface Pending {
  intent: Intent
  pins: Pins
  res: Resolution
}

export function CommandBar({
  open,
  onClose,
  tree,
  data,
  currentProject,
  currentPlanId,
  deps,
  ui,
  talkSignal,
  onOpenSession
}: {
  open: boolean
  onClose: () => void
  tree: readonly WorkspaceProject[]
  data: WorkspaceData | null
  currentProject: string | null
  currentPlanId: string | null
  deps: Omit<ExecDeps, 'tasks' | 'dispatches' | 'nowMs' | 'ui'>
  /** The app's Job action ui (confirm dialogs, toasts); its errors are also said in the conversation. */
  ui: ActionUi
  /** Bumped by the voice shortcut: starts recording, or stops and sends what was said. */
  talkSignal: number
  onOpenSession: (sessionId: string, jobId: string | undefined) => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const tr = t as unknown as ActionUi['t']
  const [input, setInput] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const speech = useMemo(() => whisperSpeech((wav) => window.api.command.transcribe(wav)), [])
  const dir = useMemo(() => directoryOf(tree, data, currentProject, currentPlanId), [tree, data, currentProject, currentPlanId])
  // W9-D: the search half. Attention is read only while the box is open.
  const attention = useAttention(open ? tree.flatMap((p) => p.plans.flatMap((pl) => planSessions(pl).map((s) => s.sessionId))) : [])
  const source = useMemo(() => (open ? boxSourceOf(tree, data, attention) : null), [open, tree, data, attention])
  const hits = useMemo(() => (source ? boxHits(source, input.trim()) : []), [source, input])
  const mode = boxModeOf(input, hits.length)
  const [sel, setSel] = useState(0)
  useEffect(() => setSel(0), [input])
  const pick = (h: BoxHit): void => {
    onClose()
    if (h.kind === 'session') openConsole(h.sessionId)
    else openPlan(h.jobId, h.kind === 'task' ? 'tasks' : undefined)
  }

  const say = (who: Entry['who'], lines: Line[]): void => {
    if (lines.length > 0) setEntries((e) => [...e.slice(-49), { who, lines }])
  }
  const barUi: ActionUi = {
    ...ui,
    error: (m, o) => {
      ui.error(m, o)
      say('coordinator', [{ text: m }])
    }
  }

  const evaluate = async (intent: Intent, pins: Pins, trigger: Trigger): Promise<void> => {
    const res = resolveIntent(intent, dir, pins)
    if (!res.ok || !mayStart(intent.kind, trigger)) {
      setPending({ intent, pins, res })
      return
    }
    setPending(null)
    setBusy(true)
    try {
      say(
        'coordinator',
        await execute(res, { ...deps, ui: barUi, tasks: data?.tasks ?? [], dispatches: data?.dispatches ?? [], nowMs: Date.now() })
      )
    } catch (e) {
      say('coordinator', [{ text: e instanceof Error ? e.message : String(e) }])
    } finally {
      setBusy(false)
    }
  }

  const submit = async (text: string): Promise<void> => {
    const said = text.trim()
    if (said === '' || busy) return
    setInput('')
    setPending(null)
    say('you', [{ text: said }])
    let intent = fastParse(said)
    if (!intent) {
      setBusy(true)
      try {
        const account = await deps.coordinatorAccount()
        if (account === null) return say('coordinator', [{ text: tr('command.noAccount') }])
        const status = (data ? dir.plans : []).map((p) => ({ jobId: p.jobId, status: planStatus(p, data?.tasks ?? []) }))
        const parsed = await window.api.command.parse(account, parsePrompt(said, dir, status))
        if (!parsed.ok) return say('coordinator', [{ text: tr('command.parseFailed', { reason: parsed.reason }) }])
        intent = parsed.intent
      } catch (e) {
        return say('coordinator', [{ text: tr('command.parseFailed', { reason: String(e) }) }])
      } finally {
        setBusy(false)
      }
    }
    await evaluate(intent, {}, 'auto')
  }

  // Held, as the button or shortcut says: a release that lands while the microphone is still opening cancels it
  const holding = useRef(false)
  const startTalk = async (): Promise<void> => {
    if (recording || busy) return
    holding.current = true
    try {
      await speech.start()
      if (!holding.current) return speech.cancel()
      setRecording(true)
    } catch (e) {
      say('coordinator', [{ text: tr('command.voice.micFailed', { reason: e instanceof Error ? e.message : String(e) }) }])
    }
  }
  const stopTalk = async (): Promise<void> => {
    holding.current = false
    if (!recording) return
    setRecording(false)
    setBusy(true)
    let heard
    try {
      heard = await speech.stop()
    } catch (e) {
      heard = { ok: false as const, reason: e instanceof Error ? e.message : String(e) }
    } finally {
      setBusy(false)
    }
    if (!heard.ok)
      say('coordinator', [{ text: heard.reason === 'not-configured' ? tr('command.voice.notConfigured') : tr('command.voice.failed', { reason: heard.reason }) }])
    else if (heard.text !== '') await submit(heard.text)
  }

  // The voice shortcut toggles: first press records, the next one sends
  const lastTalk = useRef(talkSignal)
  useEffect(() => {
    if (talkSignal === lastTalk.current) return
    lastTalk.current = talkSignal
    void (recording ? stopTalk() : startTalk())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new press decides this
  }, [talkSignal])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else speech.cancel()
    // the microphone is closed when the bar closes, even mid-recording
    if (!open) setRecording(false)
  }, [open, speech])

  // W5-C: a click away from the bar or Escape from anywhere closes it (not while the app's dialog is up). Closing goes
  // through onClose, so the effect above still stops the microphone mid-recording.
  useEffect(() => {
    if (!open) return
    return armBarClose(window, {
      inside: (n) => n instanceof Node && barRef.current?.contains(n) === true,
      confirmOpen: isConfirmOpen,
      close: () => closeRef.current()
    })
  }, [open])

  if (!open) return null
  const describe = (p: Pending): string => {
    if (!p.res.ok) return ''
    const r = p.res
    const what =
      r.session !== undefined
        ? r.session.session.label
        : r.plan !== undefined
          ? `${r.plan.projectName} › ${r.plan.name}`
          : r.project !== undefined
            ? r.project.name
            : r.plans !== undefined
              ? tr('command.scope.plans', { count: r.plans.length })
              : ''
    return `${tr(`command.kind.${p.intent.kind}`)}${what ? `: ${what}` : ''}`
  }
  const lineButton = (l: Line, i: number): React.JSX.Element =>
    l.sessionId !== undefined || l.jobId !== undefined ? (
      <button
        key={i}
        className="command-line command-link"
        onClick={() => (l.sessionId !== undefined ? onOpenSession(l.sessionId, l.jobId) : openPlan(l.jobId!))}
      >
        {l.text}
      </button>
    ) : (
      <div key={i} className="command-line">
        {l.text}
      </div>
    )

  return (
    <div ref={barRef} className="command-bar" role="dialog" aria-label={tr('command.title')}>
      <div className="command-log">
        {entries.map((en, i) => (
          <div key={i} className={`command-entry command-${en.who}`}>
            {en.lines.map(lineButton)}
          </div>
        ))}
        {pending && !pending.res.ok && (
          <div className="command-entry command-coordinator">
            <div className="command-line">
              {tr(`command.clarify.${pending.res.miss.why}`, { what: tr(`command.what.${pending.res.miss.what}`), name: pending.res.miss.name ?? '' })}
            </div>
            <div className="command-choices">
              {pending.res.miss.candidates.map((c, i) => (
                <button key={i} className="command-choice" onClick={() => void evaluate(pending.intent, { ...pending.pins, ...c.pin }, 'auto')}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {pending && pending.res.ok && (
          <div className="command-entry command-coordinator command-preview">
            <div className="command-line">{describe(pending)}</div>
            {pending.intent.kind === 'send' && <div className="command-line command-quote">“{pending.intent.text}”</div>}
            <div className="command-choices">
              {/* `confirm` runs a function that asks in the app's dialog (jobActions); this click only opens it */}
              <button className="command-run" disabled={busy} onClick={() => void evaluate(pending.intent, pending.pins, 'submit')}>
                {SAFETY[pending.intent.kind] === 'confirm' ? tr('command.confirm') : tr('command.run')}
              </button>
              <button className="command-choice" onClick={() => setPending(null)}>
                {tr('command.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
      {input.trim() !== '' && mode === 'search' && (
        <ul className="command-hits" role="listbox" aria-label={tr('command.title')}>
          {hits.length === 0 && <li className="command-nohit">{tr('command.noMatch')}</li>}
          {hits.map((h, i) => (
            <li key={h.key} role="option" aria-selected={i === sel}>
              <button className={`command-hit${i === sel ? ' selected' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => pick(h)}>
                <span className="command-hit-kind">{tr(`command.group.${h.kind}s`)}</span>
                <span className="command-hit-main">
                  <span className="command-hit-title">{h.title}</span>
                  <span className="command-hit-where">{h.where}</span>
                </span>
                {h.kind === 'session' && h.waiting && <span className="command-hit-wait">waiting</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="command-input-row">
        <input
          ref={inputRef}
          className="command-input"
          value={input}
          disabled={busy}
          placeholder={recording ? tr('command.voice.listening') : tr('command.placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (mode === 'search' && hits.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length)
              return
            }
            if (e.key !== 'Enter') return
            e.preventDefault()
            // A search opens the chosen hit; a sentence falls through to the command below
            if (input.trim() !== '' && mode === 'search') {
              if (hits[sel]) pick(hits[sel])
              return
            }
            // Enter on an empty line runs an `act` preview; a `confirm` still opens its dialog first
            if (input.trim() === '' && pending?.res.ok) void evaluate(pending.intent, pending.pins, 'submit')
            else void submit(input)
          }}
        />
        <button
          className={`command-mic${recording ? ' recording' : ''}`}
          title={tr('command.voice.hold')}
          aria-label={tr('command.voice.hold')}
          aria-pressed={recording}
          disabled={busy && !recording}
          onPointerDown={() => void startTalk()}
          onPointerUp={() => void stopTalk()}
          onPointerLeave={() => void stopTalk()}
        >
          <MicIcon className="size-4" />
        </button>
        <button className="command-close" title={tr('command.close')} aria-label={tr('command.close')} onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
