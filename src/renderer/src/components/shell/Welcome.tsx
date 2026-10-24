// DESIGN-W13 §5: the Welcome view, shown when the editor area holds nothing (and as `view:welcome`): New plan, Open a
// console, the open project's five newest plans, and the workbench keys.
import { formatChord, type ActionId } from '../../../../core/keys/binding'
import { useEffect, useState } from 'react'
import type { JobRow, OrchSnapshot } from '../../../../core/types'
import type { MessageKey } from '../../../../core/i18n'
import { jobName } from '../../lib/jobName'
import { Button, Icon, Kbd } from '../ui'
import { GetStarted } from '../onboarding/GetStarted'
import { projectDialogOf } from '../onboarding/onboardingModel'
import { openView } from './navigation'
import type { AppState } from '../../state/appState'

export type WelcomeProps = Pick<AppState, 't' | 'orchSnapshot' | 'bindingsRef' | 'canStart' | 'setShowNew' | 'currentProject' | 'setOpenRun' | 'setDetail' | 'projectAnchor' | 'setProjectDialog'>

const KEYS: Array<[ActionId, MessageKey]> = [
  ['palette.open', 'shell.welcome.keyPalette'],
  ['quickOpen', 'shell.welcome.keyQuickOpen'],
  ['sidebar.toggle', 'shell.welcome.keySidebar'],
  ['panel.toggle', 'shell.welcome.keyPanel'],
  ['settings.open', 'shell.welcome.keySettings'],
  ['activity.agents', 'shell.welcome.keyAgents']
]

/** The five newest plans, newest first (createdAt; a row without one sorts last). */
export function recentPlans(rows: readonly JobRow[], n = 5): JobRow[] {
  return rows
    .filter((r) => !r.archivedAt)
    .slice()
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, n)
}

export function Welcome({ t, orchSnapshot, bindingsRef, canStart, setShowNew, currentProject, setOpenRun, setDetail, projectAnchor, setProjectDialog }: WelcomeProps): React.JSX.Element {
  // the plan list rows' own way in (PlansPage acts.onOpen); its tab follows openRun
  const open = (runId: string): void => {
    setDetail(null)
    if (currentProject) setOpenRun({ projectPath: currentProject, runId })
  }
  // The live snapshot is only kept while the Plans view or a plan page shows (useLiveData): with the Agents view open it
  // is empty and this said "No plans in this project yet." beside a project with plans. Then one read of its own.
  const [peeked, setPeeked] = useState<OrchSnapshot | null>(null)
  const held = orchSnapshot?.runs ?? []
  useEffect(() => {
    setPeeked(null)
    if (!currentProject || held.length > 0) return
    let alive = true
    void (window.api.orch.peek(currentProject) as Promise<OrchSnapshot | null>).then(
      (snap) => alive && setPeeked(snap),
      () => {}
    )
    return () => {
      alive = false
    }
  }, [currentProject, held.length])
  const recent = recentPlans(held.length > 0 ? held : (peeked?.runs ?? []))
  return (
    <div className="welcome">
      <div className="welcome__inner">
        <h1 className="welcome__head">{t('shell.welcome.title')}</h1>
        {!currentProject && (
          <section className="welcome__section">
            <h2 className="welcome__label">{t('onboarding.start.title')}</h2>
            <GetStarted onChoose={projectAnchor ? (c) => setProjectDialog(projectDialogOf(c)) : undefined} />
          </section>
        )}
        <section className="welcome__section">
          <h2 className="welcome__label">{t('shell.welcome.start')}</h2>
          <Button variant="ghost" size="sm" className="welcome__link" icon={<Icon name="add" />} disabled={!canStart()} onClick={() => openView('start')}>
            {t('shell.welcome.newPlan')}
          </Button>
          <Button variant="ghost" size="sm" className="welcome__link" icon={<Icon name="terminal" />} disabled={!canStart()} onClick={() => setShowNew(true)}>
            {t('shell.welcome.openConsole')}
          </Button>
        </section>
        <section className="welcome__section">
          <h2 className="welcome__label">{t('shell.welcome.recent')}</h2>
          {recent.length === 0 ? (
            <p className="welcome__none">{t('shell.welcome.noPlans')}</p>
          ) : (
            recent.map((r) => (
              <Button key={r.id} variant="ghost" size="sm" className="welcome__link" icon={<Icon name="listTree" />} onClick={() => open(r.id)}>
                {jobName(r)}
              </Button>
            ))
          )}
        </section>
        <section className="welcome__section">
          <h2 className="welcome__label">{t('shell.welcome.keys')}</h2>
          <dl className="welcome__keys">
            {KEYS.map(([id, label]) => {
              const chord = bindingsRef.current[id]?.[0]
              return (
                <div key={id} className="welcome__key">
                  <dt>{t(label)}</dt>
                  <dd>{chord ? <Kbd>{formatChord(chord)}</Kbd> : '–'}</dd>
                </div>
              )
            })}
          </dl>
        </section>
      </div>
    </div>
  )
}
