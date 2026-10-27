// A plan's target branch: an existing branch of the project's repository, the project's own (empty), or a new one made
// here with `git-branch-create`. Shared by the New plan page and Plan settings, beside the Delivery choice. The caller
// owns the value (and saves it); this reads the branch list and makes branches.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { Button, Input, Modal, Select, type SelectOption } from '../ui'

/** Select values that are no branch (git refuses a space in a name). */
const DEFAULT_ITEM = ' default'
const CREATE_ITEM = ' create'

/** The short names of a repository's branches: locals, then remote-only ones without their remote. */
export function branchNamesOf(refs: { name: string; remote: boolean }[]): string[] {
  const names: string[] = []
  for (const r of [...refs.filter((b) => !b.remote), ...refs.filter((b) => b.remote)]) {
    const name = r.remote ? r.name.replace(/^[^/]+\//, '') : r.name
    if (name !== 'HEAD' && !names.includes(name)) names.push(name)
  }
  return names
}

export function BranchPicker({
  repoPath,
  value,
  onChange,
  command,
  defaultBranch,
  disabled,
  error
}: {
  /** The project's folder on this computer. */
  repoPath: string
  /** The picked branch; '' is the project's own. */
  value: string
  onChange: (branch: string) => void
  command: (cmd: string, args: Record<string, unknown>) => Promise<{ status: number; body: unknown }>
  /** The project's branch, named in the default row; the repository's own default when unset. */
  defaultBranch?: string
  disabled?: boolean
  /** Why the last save of the pick was refused, shown under the picker. */
  error?: string | null
}): React.JSX.Element {
  const { t } = useI18n()
  const [branches, setBranches] = useState<string[]>([])
  const [detected, setDetected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await window.api.worktrees.listBranches(repoPath)
      setBranches(branchNamesOf(r.branches ?? []))
      setDetected(r.detected)
    } catch {
      setBranches([])
    }
  }, [repoPath])
  useEffect(() => {
    void load()
  }, [load])

  const items = useMemo<SelectOption[]>(() => {
    const names = value !== '' && !branches.includes(value) ? [value, ...branches] : branches
    return [
      { value: DEFAULT_ITEM, label: t('delivery.targetDefault', { branch: defaultBranch ?? detected ?? t('delivery.defaultBranch') }) },
      ...names.map((n) => ({ value: n, label: n })),
      { value: CREATE_ITEM, label: t('delivery.targetCreate') }
    ]
  }, [branches, value, defaultBranch, detected, t])

  return (
    <>
      <Select
        className="dense"
        ariaLabel={t('delivery.target')}
        value={value === '' ? DEFAULT_ITEM : value}
        disabled={disabled}
        items={items}
        onChange={(v) => {
          if (v === CREATE_ITEM) setCreating(true)
          else onChange(v === DEFAULT_ITEM ? '' : v)
        }}
      />
      {error && <p className="jobs-empty-hint">{error}</p>}
      {creating && (
        <CreateBranch
          repoPath={repoPath}
          base={value || defaultBranch || detected || ''}
          branches={branches}
          command={command}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false)
            setBranches((cur) => (cur.includes(name) ? cur : [name, ...cur]))
            onChange(name)
            void load()
          }}
        />
      )}
    </>
  )
}

function CreateBranch({
  repoPath,
  base: initialBase,
  branches,
  command,
  onClose,
  onCreated
}: {
  repoPath: string
  base: string
  branches: string[]
  command: (cmd: string, args: Record<string, unknown>) => Promise<{ status: number; body: unknown }>
  onClose: () => void
  onCreated: (name: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [from, setFrom] = useState(initialBase)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const branch = name.trim()
    if (branch === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await command('git-branch-create', { cwd: repoPath, name: branch, ...(from !== '' ? { from } : {}) })
      const body = r.body as { error?: string; reason?: string; pushed?: boolean; pushError?: string } | null
      if (r.status >= 400) {
        setError(body?.error ?? body?.reason ?? t('delivery.targetCreateFailed'))
        return
      }
      // made, but not published: usable here, so say so without refusing it
      if (body?.pushed === false && body.pushError) toast.info(t('delivery.targetNotPushed', { branch, reason: body.pushError }))
      onCreated(branch)
    } catch {
      setError(t('delivery.targetCreateFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('delivery.targetCreateTitle')}
      size="sm"
      onClose={() => !busy && onClose()}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={name.trim() === ''}>
            {t('delivery.targetCreateOk')}
          </Button>
        </>
      }
    >
      <form
        className="create-pr"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label>
          {t('delivery.targetName')}
          <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('delivery.targetFrom')}
          <Select
            value={from}
            ariaLabel={t('delivery.targetFrom')}
            items={(from !== '' && !branches.includes(from) ? [from, ...branches] : branches).map((b) => ({ value: b, label: b }))}
            onChange={setFrom}
          />
        </label>
        {error && <p className="jobs-empty-hint">{error}</p>}
      </form>
    </Modal>
  )
}
