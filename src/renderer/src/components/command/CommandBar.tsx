// DESIGN-W13 §9: the one box is also the command palette (`>`, Ctrl+Shift+P), quick open (no prefix, Ctrl+P) and the
// Task search (`@`); a sentence is still a command for the coordinator, and the microphone and Talk key work as before.
// W9-D: this is also the session search (W3-C): text that finds a session, plan or Task is a search, a sentence is a
// command (boxMode.ts). One box, one key.
// W3-B command bar: a conversation with the coordinator (SPEC §8, §4). Typed or spoken text becomes one intent (the
// fast path, else the coordinator role model), the intent's names become exact ids or a question, and only then does
// anything run: `read` at once, `act` on Run, `confirm` through a dialog (core/intents/safety.ts).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Chip, Icon, IconButton, Kbd, Modal, type IconName } from '../ui'
import { PickKeys, PickList, pickListEnter, type PickRow } from '../QuickSwitcher'
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
import { viewTabInfo } from '../shell/viewTabs'
import { leaves, type PaneNode } from '../../../../core/panes/tree'
import { parseTab, parseViewTab, sessionTab } from '../../../../core/panes/tabId'
import { formatChord, resolveBindings } from '../../../../core/keys/binding'
import { THEME_IDS, themeById, type ThemeId } from '../../../../core/theme/themes'
import type { OrchSnapshot } from '../../../../core/types'
import { rankByFields } from '../../../../core/orchestration/sessionIndex'
import type { MessageKey } from '../../../../core/i18n'
import type { SwitcherTab } from '../../lib/tabSwitcher'
import { createLatest } from '../../lib/latest'
import { ACTIONS } from '../../lib/actions'
import { useTheme } from '../../lib/theme'
import { toast } from '../../lib/toast'
import type { ActionUi } from '../../lib/jobActions'
import { boxHits, type BoxHit } from './boxHits'
import { setHelpOpen } from '../help/helpStore'
import { boxModeOf } from './boxMode'
import { boxSourceOf } from './boxSource'
import { directoryOf, PALETTE_COMMANDS, type PaletteCommand, type PaletteCx, type PaletteStage } from './directory'
import { takeBoxRequest } from './boxStore'
import { pushRecent, quickModeOf, quickRows, rankCommands, startsSection, type QuickRow, type QuickSection } from './quickOpen'
import { execute, resolveIntent, type ExecDeps, type Line, type Resolution } from './execute'
import { whisperSpeech } from './speech'
import './command.css'

interface Entry {
  who: 'you' | 'coordinator'
  lines: Line[]
}

const RECENT_KEY = 'cm.palette.recent'
const readRecent = (): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
const writeRecent = (ids: string[]): void => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  } catch {
    // a private window: the list is just not kept
  }
}

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

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
  onOpenSession,
  keyOverrides,
  layout,
  orchSnapshot,
  onSelectTab,
  onOpenFile
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
  /** The person's own keys: the palette shows each command's chord as they have it. */
  keyOverrides: Record<string, string[]>
  /** The open tabs, for quick open's first section. */
  layout: PaneNode | null
  orchSnapshot: OrchSnapshot | null
  onSelectTab: (tabId: string) => void
  /** Opens a project file by its absolute path (a file tab, or the media viewer). */
  onOpenFile: (path: string) => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const tr = t as unknown as ActionUi['t']
  const [input, setInput] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const speech = useMemo(() => whisperSpeech((wav) => window.api.command.transcribe(wav)), [])
  const dir = useMemo(() => directoryOf(tree, data, currentProject, currentPlanId), [tree, data, currentProject, currentPlanId])
  // W9-D: the search half. Attention is read only while the box is open.
  const attention = useAttention(open ? tree.flatMap((p) => p.plans.flatMap((pl) => planSessions(pl).map((s) => s.sessionId))) : [])
  const source = useMemo(() => (open ? boxSourceOf(tree, data, attention) : null), [open, tree, data, attention])
  const qm = quickModeOf(input)
  const [stage, setStage] = useState<PaletteStage | null>(null)
  const stageRef = useRef<PaletteStage | null>(null)
  stageRef.current = stage
  const [recent, setRecent] = useState<string[]>(readRecent)
  const [files, setFiles] = useState<string[]>([])
  const hits = useMemo(
    () =>
      source && stage === null && qm.mode !== 'commands'
        ? boxHits({ ...source, help: { title: t('help.title'), where: t('help.where'), words: ['help', '?', 'f1', 'how to'] } }, qm.query)
        : [],
    [source, stage, qm.mode, qm.query, t]
  )
  // Quick open's file section: the project's file index (the `@` mentions' own walk), asked as the text changes.
  const latestFiles = useRef(createLatest())
  useEffect(() => {
    const ticket = latestFiles.current.next()
    if (!open || stage !== null || qm.mode !== 'open' || qm.query === '' || !currentProject) return setFiles([])
    window.api.files.index(currentProject, qm.query).then(
      (r) => latestFiles.current.isCurrent(ticket) && setFiles(r.paths),
      () => latestFiles.current.isCurrent(ticket) && setFiles([])
    )
  }, [open, stage, qm.mode, qm.query, currentProject])
  const mode = stage === null && qm.mode === 'open' ? boxModeOf(qm.query, hits.length + files.length) : 'search'
  const [sel, setSel] = useState(0)
  // A stage opens on the row that is current (the theme in use), so previewing starts from what is on screen
  useEffect(() => setSel(stage && input === '' ? Math.max(0, stage.rows.findIndex((r) => r.current)) : 0), [input, stage])

  // Opens with what Ctrl+P / Ctrl+Shift+P / the command center asked for (boxStore.ts); closing drops a theme preview.
  useEffect(() => {
    if (open) {
      setInput(takeBoxRequest())
      setPending(null)
    } else {
      takeBoxRequest()
      stageRef.current?.cancel?.()
      setStage(null)
    }
  }, [open])

  const bindings = useMemo(() => resolveBindings(keyOverrides, ACTIONS), [keyOverrides])
  const { themeId, setThemeId } = useTheme()
  const tabs = useMemo<SwitcherTab[]>(() => {
    if (!open || !layout) return []
    return leaves(layout)
      .flatMap((l) => l.tabIds)
      .map((tabId): SwitcherTab => {
        const ref = parseTab(tabId)
        if (ref?.kind === 'session') {
          const s = source?.sessions.find((x) => x.sessionId === ref.id)
          return s ? { tabId, title: s.label, label: s.label, planName: s.planName, taskTitle: s.taskTitle, projectName: s.projectName } : { tabId, title: ref.id }
        }
        const view = parseViewTab(tabId)
        if (view) return { tabId, title: viewTabInfo({ t, orchSnapshot, workspaceTree: tree } as Parameters<typeof viewTabInfo>[0], view.name, view.arg).title }
        return { tabId, title: ref ? baseName(ref.id) : tabId }
      })
  }, [open, layout, source, t, orchSnapshot, tree])

  const openFileRel = (rel: string): void => {
    const root = currentProject ?? ''
    const sep = root.includes('\\') ? '\\' : '/'
    onOpenFile(`${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`)
  }
  const pickHit = (h: BoxHit): void => {
    onClose()
    if (h.kind === 'session') openConsole(h.sessionId)
    else if (h.kind === 'help') setHelpOpen(true)
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

  // W5-C: a click away from the bar or Escape closes it. W12: the ui Modal does both now (its backdrop and its Esc, and
  // the app's confirm dialog stacks above it, so neither reaches the bar while that is up). Closing goes through
  // onClose, so the effect above still stops the microphone mid-recording.

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
      <Button
        key={i}
        variant="ghost"
        size="sm"
        className="command-line ov-cmd-link"
        onClick={() => (l.sessionId !== undefined ? onOpenSession(l.sessionId, l.jobId) : openPlan(l.jobId!))}
      >
        {l.text}
      </Button>
    ) : (
      <div key={i} className="command-line">
        {l.text}
      </div>
    )

  // ---- the list under the field: one of the palette's commands, a stage's rows, the Tasks, or quick open's sections
  interface Item {
    row: PickRow
    pick: () => void
    preview?: () => void
  }
  const palette: PaletteCx = {
    t: tr,
    currentPlanId,
    plans: dir.plans,
    intent: (intent, pins) => void evaluate(intent, pins, 'submit'),
    theme: {
      current: themeId,
      ids: THEME_IDS,
      name: (id: ThemeId) => (id === 'system' ? tr('settings.theme.system') : themeById(id).name),
      preview: setThemeId,
      commit: (id) => {
        const prev = themeId
        setThemeId(id)
        void window.api.settings.setTheme(id).catch((err) => {
          setThemeId(prev)
          toast.error(tr('settings.theme.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
        })
      }
    }
  }
  const commandText = (c: PaletteCommand): string => `${tr(`palette.cat.${c.category}` as MessageKey)}: ${tr(c.label, c.name ? { name: tr(c.name) } : undefined)}`
  const runCommand = (c: PaletteCommand): void => {
    const next = pushRecent(recent, c.id)
    setRecent(next)
    writeRecent(next)
    const res = c.run(palette)
    if (res) {
      setStage(res)
      setInput('')
    } else onClose()
  }
  const items = ((): Item[] => {
    const text = (title: string, meta?: string): React.ReactNode => (
      <>
        <span className="ov-pick-title">{title}</span>
        {meta && <span className="ov-pick-meta">{meta}</span>}
      </>
    )
    if (stage) {
      const rows = qm.query === '' ? stage.rows : rankByFields(stage.rows, qm.query, (r) => [r.label.toLowerCase(), (r.detail ?? '').toLowerCase()], 50)
      return rows.map((r) => ({
        row: { key: r.key, current: r.current, className: 'pal-row', content: text(r.label, r.detail) },
        preview: r.preview,
        pick: () => {
          stageRef.current = null // a pick keeps what it set; only a close without one reverts
          setStage(null)
          r.pick()
          onClose()
        }
      }))
    }
    if (qm.mode === 'commands') {
      const { rows, recents } = rankCommands(PALETTE_COMMANDS, qm.query, recent, (c) => [commandText(c).toLowerCase(), tr(c.label, c.name ? { name: tr(c.name) } : undefined).toLowerCase()])
      return rows.map((c, i) => {
        const chord = c.action ? bindings[c.action]?.[0] : undefined
        return {
          row: {
            key: c.id,
            className: 'pal-row',
            heading: recents > 0 && (i === 0 || i === recents) ? tr(i === 0 ? 'palette.recent' : 'palette.other') : undefined,
            content: (
              <>
                <span className="ov-pick-title">{commandText(c)}</span>
                {chord && <Kbd className="pal-chord">{formatChord(chord)}</Kbd>}
              </>
            )
          },
          pick: () => runCommand(c)
        }
      })
    }
    if (qm.mode === 'tasks')
      return hits.flatMap((h): Item[] =>
        h.kind === 'task' ? [{ row: { key: h.key, className: 'pal-row', content: text(h.title, h.where) }, pick: () => pickHit(h) }] : []
      )
    const quick = quickRows({ tabs, hits, files }, qm.query)
    return quick.map((r, i) => ({
      row: {
        key: r.key,
        className: 'pal-row',
        heading: startsSection(quick, i) ? tr(`quick.section.${r.section}` as MessageKey) : undefined,
        content: (
          <>
            <Icon name={SECTION_ICON[r.section]} size={14} className="pal-icon" />
            <span className="ov-pick-title">{r.title}</span>
            {r.where && <span className="ov-pick-meta">{r.where}</span>}
            {r.section === 'console' && r.waiting && (
              <Chip tone="warn" dot>
                {tr('overlays.command.waiting')}
              </Chip>
            )}
          </>
        )
      },
      pick: () => pickQuick(r)
    }))
  })()
  const pickQuick = (r: QuickRow): void => {
    onClose()
    if (r.section === 'tab') onSelectTab(r.tabId)
    else if (r.section === 'plan') openPlan(r.jobId)
    else if (r.section === 'file') openFileRel(r.path)
    else if (r.section === 'console') openConsole(r.sessionId)
    else setHelpOpen(true)
  }
  // The highlighted row of a stage is previewed (the theme changes as the arrows move)
  const previewRef = useRef<(() => void) | undefined>(undefined)
  previewRef.current = stage ? items[sel]?.preview : undefined
  const previewKey = stage ? items[sel]?.row.key : undefined
  useEffect(() => {
    previewRef.current?.()
  }, [previewKey])
  if (!open) return null

  const inList = stage !== null || qm.mode !== 'open' || (mode === 'search' && (qm.query !== '' || items.length > 0))
  const placeholder = recording
    ? tr('command.voice.listening')
    : stage
      ? stage.title
      : qm.mode === 'commands'
        ? tr('palette.placeholder')
        : qm.mode === 'tasks'
          ? tr('quick.placeholderTasks')
          : tr('command.placeholder')
  return (
    <Modal title={tr('command.title')} closeLabel={tr('command.close')} onClose={onClose} footer={inList ? <PickKeys /> : undefined}>
      <div className="ov-cmd">
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
                  <Button key={i} size="sm" onClick={() => void evaluate(pending.intent, { ...pending.pins, ...c.pin }, 'auto')}>
                    {c.label}
                  </Button>
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
                <Button size="sm" variant="primary" disabled={busy} onClick={() => void evaluate(pending.intent, pending.pins, 'submit')}>
                  {SAFETY[pending.intent.kind] === 'confirm' ? tr('command.confirm') : tr('command.run')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                  {tr('command.cancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="command-input-row">
          <Icon name="search" className="command-input-icon" />
          <input
            ref={inputRef}
            className="command-input"
            value={input}
            disabled={busy}
            aria-label={tr('command.title')}
            placeholder={placeholder}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              // Backspace on an empty stage field goes back to the commands
              if (stage && input === '' && e.key === 'Backspace') {
                e.preventDefault()
                stage.cancel?.()
                setStage(null)
                setInput('>')
                return
              }
              if (inList && pickListEnter(listRef.current, e.key, sel, items.length)) {
                e.preventDefault()
                return
              }
              if (e.key !== 'Enter') return
              e.preventDefault()
              // Enter on an empty line runs an `act` preview; a `confirm` still opens its dialog first
              if (input.trim() === '' && pending?.res.ok && stage === null) {
                void evaluate(pending.intent, pending.pins, 'submit')
                return
              }
              // A list opens the highlighted row; a sentence falls through to the command below
              if (inList) {
                items[sel]?.pick()
                return
              }
              void submit(input)
            }}
          />
          <IconButton
            className={`command-mic${recording ? ' recording' : ''}`}
            icon={<Icon name="mic" />}
            label={tr('command.voice.hold')}
            active={recording}
            aria-pressed={recording}
            disabled={busy && !recording}
            onPointerDown={() => void startTalk()}
            onPointerUp={() => void stopTalk()}
            onPointerLeave={() => void stopTalk()}
          />
        </div>
        {inList && (
          <PickList
            rows={items.map((x) => x.row)}
            sel={sel}
            onSel={setSel}
            onPick={(i) => items[i]?.pick()}
            field={inputRef}
            label={tr('command.title')}
            empty={tr('command.noMatch')}
            listRef={listRef}
          />
        )}
      </div>
    </Modal>
  )
}

const SECTION_ICON: Record<QuickSection, IconName> = { tab: 'file', plan: 'layers', file: 'file', console: 'terminal', help: 'info' }
