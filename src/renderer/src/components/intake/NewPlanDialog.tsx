import type { Account } from '../../../../core/types'
import { MAX_CONCURRENT_WORKERS } from '../../../../core/orchestration/types'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'
import { AccountSelect } from '../AccountSelect'
import { Button, Modal } from '../ui'
import type { IntakeTab } from './intakeRequest'
import { useIntake } from './useIntake'

const TABS: IntakeTab[] = ['describe', 'files', /* W8-C prompts mode */ 'prompts', 'audit', 'github']

/** W6-A "New plan": a Job from a description, files, an audit or GitHub issues, with the owner's extra instructions.
 *  It makes the Job (`jobs-create` / `jobs-create-from-issue`, intakeRequest.ts) and starts its planner (`jobs-plan`);
 *  the Host checks and copies everything. This computer's projects only: attached paths are this computer's.
 *  W9-E: the state and calls are useIntake's, shared with the Start page; this is the dialog frame NewRunModal opens. */
export function NewPlanDialog({
  door,
  cwd,
  accounts,
  onClose,
  onCreated,
  concurrency: initialConcurrency,
  initialText
}: {
  door: OrchDoor
  /** The open project's folder: picked first. */
  cwd: string
  accounts: Account[] | null
  onClose: () => void
  onCreated: (jobId: string) => void
  /** W7-D (#67): the worker count typed in the form this dialog was opened from, kept across the switch. */
  concurrency?: number
  /** W7-B: the description the dialog opens with (the first plan of a new project). */
  initialText?: string
}): React.JSX.Element {
  const { t } = useI18n()
  const {
    tab, setTab, projects, projectId, setProjectId, text, setText, fixlist, setFixlist, approveAsk, setApproveAsk, files,
    setFiles, addFiles, scope, setScope, query, setQuery, mine, setMine, issues, picked, setPicked, assignMe, setAssignMe,
    instructions, setInstructions, account, setAccount, concurrency, setConcurrency, after, setAfter, plans, busy, error,
    request, create
  } = useIntake({ door, cwd, onCreated, concurrency: initialConcurrency, initialText })

  return (
    <Modal
      title={t('intake.title')}
      closeLabel={t('common.cancel')}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={busy || request === null} onClick={() => void create()}>
            {t('intake.create')}
          </Button>
        </>
      }
    >
      <div className="field">
        <label>{t('intake.project')}</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'primary' : ''} onClick={() => setTab(k)}>
            {t(`intake.tab.${k}` as const)}
          </button>
        ))}
      </div>
      {tab === 'describe' && (
        <div className="field">
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('intake.describe')} autoFocus />
          <label className="check-small">
            <input type="checkbox" checked={fixlist} onChange={(e) => setFixlist(e.target.checked)} />
            {t('intake.fixlist')}
          </label>
        </div>
      )}
      {(tab === 'files' || tab === 'prompts') && (
        <div className="field">
          {tab === 'prompts' && <p className="modal-hint">{t('intake.promptsHint')}</p>}
          <div
            className="intake-drop"
            style={{ border: '1px dashed currentColor', padding: 16, textAlign: 'center' }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              addFiles(e.dataTransfer.files)
            }}
          >
            {t('intake.drop')}
            <input
              type="file"
              multiple
              {...(tab === 'prompts' ? { accept: '.md' } : {})}
              aria-label={t('intake.drop')}
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>
          {files.map((f) => (
            <div key={f} className="row">
              <span>{f}</span>
              <button aria-label={t('common.cancel')} onClick={() => setFiles((cur) => cur.filter((x) => x !== f))}>
                ×
              </button>
            </div>
          ))}
          {tab === 'files' && <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('intake.note')} />}
          {tab === 'prompts' && files.length === 0 && (
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('intake.promptsPaste')} />
          )}
          {tab === 'prompts' && (
            <label className="check-small">
              <input type="checkbox" checked={approveAsk} onChange={(e) => setApproveAsk(e.target.checked)} />
              {t('intake.promptsAsk')}
            </label>
          )}
        </div>
      )}
      {tab === 'audit' && (
        <div className="field">
          <label>{t('intake.scope')}</label>
          <input type="text" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="all" />
          <p className="modal-hint">{t('intake.auditHint')}</p>
        </div>
      )}
      {tab === 'github' && (
        <div className="field">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('intake.search')} />
          <label className="check-small">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            {t('intake.mine')}
          </label>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {issues.map((i) => (
              <label key={i.id} className="check-small" title={i.reason}>
                <input
                  type="checkbox"
                  disabled={i.selectable === false}
                  checked={picked.includes(i.id)}
                  onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, i.id] : cur.filter((x) => x !== i.id)))}
                />
                #{i.id} {i.title}
              </label>
            ))}
          </div>
          <label className="check-small">
            <input type="checkbox" checked={assignMe} onChange={(e) => setAssignMe(e.target.checked)} />
            {t('intake.assignMe')}
          </label>
        </div>
      )}
      <div className="field">
        <label>{t('intake.instructions')}</label>
        <textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="intake-concurrency">{t('intake.concurrency')}</label>
        <input
          id="intake-concurrency"
          type="number"
          className="jobs-concurrency"
          min={1}
          max={MAX_CONCURRENT_WORKERS}
          value={concurrency}
          onChange={(e) => {
            const n = e.target.valueAsNumber
            setConcurrency(Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), MAX_CONCURRENT_WORKERS) : 1)
          }}
        />
      </div>
      {accounts !== null && (
        <div className="field">
          <label>{t('jobs.new.coordinator')}</label>
          <AccountSelect accounts={accounts} value={account} onChange={setAccount} allLabel={t('jobs.new.coordinatorPick')} />
        </div>
      )}
      {/* W8-C plan after plan */}
      <div className="field">
        <label htmlFor="intake-after">{t('intake.after')}</label>
        <select id="intake-after" value={after} onChange={(e) => setAfter(e.target.value)}>
          <option value="">{t('intake.afterNone')}</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="warn">{error}</p>}
    </Modal>
  )
}
