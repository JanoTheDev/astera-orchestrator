import { useMemo, useState } from 'react'
import { searchSessions, type InboxItem, type IndexedSession } from '../../../../core/orchestration/sessionIndex'
import './search.css'

/** What a row says about a session besides its name (SPEC §6 "what each session shows"). */
const factsOf = (s: IndexedSession): string =>
  [s.taskTitle, s.model, s.accountId, s.branch, s.cwd].filter(Boolean).join(' · ')

/** The words of an inbox row: what waits, and where. */
function inboxText(item: InboxItem): { what: string; where: string; title: string } {
  switch (item.kind) {
    case 'session':
      return { what: `${item.session.label} is waiting`, where: item.session.projectName, title: factsOf(item.session) }
    case 'gate':
      return {
        what: item.gate.question,
        where: `${item.projectName} › ${item.planName}${item.taskTitle ? ` · ${item.taskTitle}` : ''}`,
        title: item.gate.question
      }
    case 'approval':
      return { what: 'Plan awaits approval', where: `${item.projectName} › ${item.planName}`, title: 'Open the plan to approve it' }
  }
}

const jobOf = (item: InboxItem): string => (item.kind === 'session' ? item.session.jobId : item.jobId)
const sessionOf = (item: InboxItem): string | undefined => (item.kind === 'session' ? item.session.sessionId : item.sessionId)

/**
 * W3-C: search every project's sessions, and the "needs my input" list. Both keep a row's project and plan in view,
 * and selecting one goes through the W2-B navigation: a session focuses in its plan's workspace, and a row without an
 * open session opens the plan.
 */
export function SessionSearch({
  index,
  inbox,
  showInbox,
  canOpenSession,
  onOpenSession,
  onSelectPlan
}: {
  index: IndexedSession[]
  inbox: InboxItem[]
  showInbox: boolean
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string, jobId: string) => void
  onSelectPlan: (jobId: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchSessions(index, query), [index, query])
  const go = (jobId: string, sessionId: string | undefined): void => {
    if (sessionId !== undefined && canOpenSession(sessionId)) onOpenSession(sessionId, jobId)
    else onSelectPlan(jobId)
  }

  return (
    <div className="ss">
      <input
        className="ss-input"
        type="search"
        placeholder="Search sessions, plans, tasks…"
        aria-label="Search sessions across projects"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQuery('')
          if (e.key === 'Enter' && results[0]) go(results[0].jobId, results[0].sessionId)
        }}
      />
      {query.trim() !== '' && (
        <ul className="ss-list" aria-label="Search results">
          {results.length === 0 && <li className="ws-empty">No sessions match</li>}
          {results.map((s) => (
            <li key={s.sessionId}>
              <button className="ws-row ss-row" title={factsOf(s)} onClick={() => go(s.jobId, s.sessionId)}>
                <span className={`ws-dot ws-${s.attention}`} aria-label={s.attention} />
                <span className="ss-main">
                  <span className="ws-name">{s.label}</span>
                  <span className="ss-where">
                    {s.projectName} › {s.planName}
                    {s.taskTitle ? ` · ${s.taskTitle}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() === '' && showInbox && (
        <ul className="ss-list" aria-label="Needs my input">
          {inbox.length === 0 && <li className="ws-empty">Nothing needs your input</li>}
          {inbox.map((item) => {
            const t = inboxText(item)
            const key = item.kind === 'session' ? item.session.sessionId : item.kind === 'gate' ? item.gate.id : `approve-${item.jobId}`
            return (
              <li key={key}>
                <button className="ws-row ss-row" title={t.title} onClick={() => go(jobOf(item), sessionOf(item))}>
                  <span className="ws-dot ws-waiting" aria-hidden />
                  <span className="ss-main">
                    <span className="ws-name">{t.what}</span>
                    <span className="ss-where">{t.where}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
