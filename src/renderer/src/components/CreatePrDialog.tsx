import { useEffect, useRef, useState } from 'react'
import type { BranchRef, WorktreeListItem } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Button, Icon, Modal, Select, Checkbox, Field } from './ui'

type Failure = { kind: string; detail: string; pushed: boolean; stage: 'push' | 'create' }

/** Turns a worktree into a pull request. Pushes first when the branch is not on the remote — the
 *  submit label says so rather than doing it quietly. Failures stay in this dialog: they answer a
 *  button the person just pressed, and the next move belongs where they are looking. */
export function CreatePrDialog({
  worktree,
  base: initialBase,
  needsPush,
  onDone,
  onCancel
}: {
  worktree: WorktreeListItem
  base: string
  needsPush: boolean
  onDone: () => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [base, setBase] = useState(initialBase)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  const [dirtyCount, setDirtyCount] = useState(0)
  const [commitCount, setCommitCount] = useState(0)
  // Both counts are measured against the base, so they are held here rather than passed in: the
  // base can be changed after the dialog opens, and a hint describing the base it no longer
  // targets is worse than none.
  const [behindCount, setBehindCount] = useState<number | null>(null)
  const [branches, setBranches] = useState<BranchRef[]>([])
  const [branchesUnavailable, setBranchesUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  // Set once the person edits title or body. Same idiom as NewSessionDialog's touched: it stops a
  // base change from reseeding over their edits, since correcting the base is the reason this
  // dialog exists and must not cost them the text they just wrote.
  const touched = useRef(false)

  // Seeding is local git only — commits and a status count. Nothing here touches the network,
  // so the dialog opens without waiting on gh. `cancelled` guards against two base changes in
  // quick succession resolving out of order and letting a stale response overwrite state for a
  // base the person has already moved off.
  useEffect(() => {
    let cancelled = false
    void window.api.pr
      .draftFor({ worktreePath: worktree.path, branch: worktree.branch, base })
      .then((d) => {
        if (cancelled) return
        if (!touched.current) {
          setTitle(d.title)
          setBody(d.body)
        }
        setDirtyCount(d.dirtyCount)
        setCommitCount(d.commitCount)
        setBehindCount(d.behindCount)
      })
    return () => {
      cancelled = true
    }
  }, [worktree.path, worktree.branch, base])

  useEffect(() => {
    // null is "git did not answer", not "no branches" — the base stays as given and the row says the
    // list could not be checked (branchesUnavailable) rather than offering an empty picker.
    let cancelled = false
    setBranchesUnavailable(false)
    void window.api.worktrees
      .listBranches(worktree.repoPath)
      .then((r) => {
        if (cancelled) return
        setBranches(r.branches ?? [])
        setBranchesUnavailable(r.branches === null)
      })
      .catch(() => {
        if (!cancelled) setBranchesUnavailable(true)
      })
    return () => {
      cancelled = true
    }
  }, [worktree.repoPath])

  // createFailedPushed tells the person the retry skips the push, so it has to. needsPush is fixed
  // at open time; once the push has succeeded, repeating it can fail on someone else's meanwhile
  // push and cost them the create retry they were promised.
  const willPush = needsPush && failure?.pushed !== true

  const submit = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      const r = await window.api.pr.create({
        worktreePath: worktree.path,
        repoPath: worktree.repoPath,
        branch: worktree.branch,
        base,
        title,
        body,
        draft,
        needsPush: willPush
      })
      if (r.ok) {
        onDone()
        // One action per toast: Open PR on the success one, Copy link on a second
        toast.success(t('pr.create.done'), { action: { label: t('pr.create.openPr'), onClick: () => void window.api.system.openExternal(r.url) } })
        toast.info(r.url, {
          action: {
            label: t('pr.create.copyLink'),
            onClick: () => {
              window.api.clipboard.writeText(r.url)
              toast.success(t('github.badge.linkCopied'))
            }
          }
        })
      }
      else setFailure({ kind: r.kind, detail: r.detail, pushed: r.pushed, stage: r.stage })
    } finally {
      setBusy(false)
    }
  }

  const existingUrl = failure?.kind === 'exists' ? extractUrl(failure.detail) : null
  // Select falls back to its placeholder when value is not among items, and branches is empty
  // while listBranches loads and stays empty when it fails. The base would then read as
  // "(Not selected)" while it is in fact set — exactly the hiding of the target this row exists
  // to prevent.
  const baseItems = branches.map((b) => ({ value: b.name, label: b.name }))
  if (!baseItems.some((i) => i.value === base)) baseItems.unshift({ value: base, label: base })

  return (
    <Modal
      title={t('pr.create.title')}
      onClose={() => !busy && onCancel()}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || title === ''}>
            {busy ? t('pr.create.submitting') : willPush ? t('pr.create.submitWithPush') : t('pr.create.submit')}
          </Button>
        </>
      }
    >
      <div className="create-pr">
        {busy && (
          <div className="loading-overlay">
            <span className="loading-spinner" aria-hidden="true" />
            {t('pr.create.submitting')}
          </div>
        )}
        {/* The branch and its target sit above every field: a create action must never hide
            which branch it is acting on, and this app's own base mistake is why. */}
        <div className="pr-base-row">
          <span className="mono">{worktree.branch}</span>
          <Icon name="chevronRight" size={14} />
          <Select
            items={baseItems}
            value={base}
            onChange={setBase}
            ariaLabel={t('pr.create.base')}
          />
        </div>
        {branchesUnavailable && <span className="ui-note">{t('pr.create.branchesUnavailable')}</span>}
        <Field
          label={t('pr.create.prTitle')}
          value={title}
          onChange={(e) => {
            touched.current = true
            setTitle(e.target.value)
          }}
        />
        <Field
          kind="textarea"
          label={t('pr.create.body')}
          rows={6}
          value={body}
          onChange={(e) => {
            touched.current = true
            setBody(e.target.value)
          }}
        />
        <Checkbox label={t('pr.create.draft')} checked={draft} onChange={setDraft} />
        {willPush && <span className="ui-note">{t('pr.create.willPush')}</span>}
        {dirtyCount > 0 && (
          <span className="ui-note">{t('pr.create.dirty', { count: dirtyCount })}</span>
        )}
        {commitCount > 0 && (
          <span className="ui-note">{t(commitCount === 1 ? 'pr.create.commits.one' : 'pr.create.commits', { count: commitCount })}</span>
        )}
        {behindCount !== null && behindCount > 0 && (
          <span className="ui-note">{t('pr.create.behind', { count: behindCount })}</span>
        )}
        {failure && (
          <div className="pr-create-failure">
            <p>
              {failure.stage === 'push'
                ? t('pr.create.pushFailed')
                : failure.kind === 'exists'
                  ? t('pr.create.exists')
                  : failure.pushed
                    ? t('pr.create.createFailedPushed')
                    : t('pr.create.createFailed')}
            </p>
            <pre className="pr-create-detail">{failure.detail}</pre>
            {existingUrl && (
              <Button
                size="sm"
                icon={<Icon name="external" size={14} />}
                onClick={() => void window.api.system.openExternal(existingUrl)}
              >
                {t('pr.create.openExisting')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** gh prints the existing PR's URL in the "already exists" message; pulling it out is what makes
 *  "Open it" possible instead of sending the person to find it themselves. */
function extractUrl(detail: string): string | null {
  const m = detail.match(/https:\/\/\S+/)
  return m ? m[0] : null
}
