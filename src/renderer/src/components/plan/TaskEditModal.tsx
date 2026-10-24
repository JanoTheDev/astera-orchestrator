// T2 Task details: the edit form of one Task (`task-update` with plan fields), and the plan fields and dependency
// picker it shares with the new-Task form (NewTaskModal). What may change is taskEdit.ts's taskEditOf, the Host's
// editPlanTask rules: a field it refuses is drawn disabled, with the reason above the fields. Save sends only the
// changed fields; a refusal stays in the form, which stays open.
import { useState } from 'react'
import type { JobTask } from '../../../../core/types'
import type { Task } from '../../../../core/orchestration/types'
import { TASK_KINDS } from '../../../../core/orchestration/types'
import { DIFFICULTIES, EFFORTS } from '../../../../core/orchestration/roleModels'
import { useI18n } from '../../i18n/I18nProvider'
import { isOutcomeUnknown, replyNote, type OrchDoor } from '../../lib/orchDoor'
import { Button, Field, Icon, IconButton, Modal, Select, type SelectOption } from '../ui'
import '../formDialogs.css'
import { canEdit, draftOf, editArgsOf, type EditField, type TaskDraft, type TaskEdit } from './taskEdit'

/** The Tasks a Task may wait on, picked by title: a Select that adds one, and the picked ones as removable chips.
 *  (moved from NewTaskModal) 아직 안 고른 Task 만 항목으로 낸다 — 고른 것을 다시 고르면 deps 에 같은 id 가 둘 들어가고
 *  그래프가 같은 선을 두 번 긋는다. 이 셀렉트는 값을 들고 있지 않고(value 는 늘 '') 고르는 순간
 *  목록에 더하는 **더하기 손잡이**다: 의존은 여럿일 수 있는데 Select 의 값은 하나이므로, 고른
 *  것들은 아래 칩으로 서고 그 자리에서 지운다. */
export function DepsPicker({
  label,
  addLabel,
  hint,
  tasks,
  deps,
  onChange,
  disabled = false
}: {
  label: string
  /** The Select's placeholder. */
  addLabel: string
  hint?: string
  /** The candidates: the plan's Tasks, without the Task being edited. */
  tasks: readonly JobTask[]
  deps: readonly string[]
  onChange: (deps: string[]) => void
  disabled?: boolean
}): React.JSX.Element | null {
  const { t } = useI18n()
  const items: SelectOption[] = tasks.filter((tk) => !deps.includes(tk.id)).map((tk) => ({ value: tk.id, label: tk.title }))
  const titleOf = (id: string): string => tasks.find((tk) => tk.id === id)?.title ?? id
  // Nothing to pick and nothing picked (a plan's first Task): no dead field
  if (items.length === 0 && deps.length === 0) return null
  return (
    <div className="ui-field">
      <span className="ui-field__label">{label}</span>
      {/* 다 골랐으면 셀렉트가 빠진다 — 빈 셀렉트는 눌러도 아무것도 없는 자리가 된다 */}
      {items.length > 0 && (
        <Select items={items} value="" placeholder={addLabel} disabled={disabled} onChange={(id) => onChange([...deps, id])} ariaLabel={label} />
      )}
      {deps.length > 0 && (
        <div className="detail-dep-list">
          {deps.map((id) => (
            <span key={id} className="detail-chip detail-dep">
              <span>{titleOf(id)}</span>
              <IconButton
                size="sm"
                icon={<Icon name="close" size={14} />}
                label={t('plan.edit.field.removeDep', { task: titleOf(id) })}
                disabled={disabled}
                onClick={() => onChange(deps.filter((x) => x !== id))}
              />
            </span>
          ))}
        </div>
      )}
      {hint !== undefined && <p className="ui-field__hint">{hint}</p>}
    </div>
  )
}

/** The planner's fields of a Task: its worker prompt, acceptance criteria and kind, and in the edit form also its
 *  difficulty and affected paths. `locked` names the fields drawn disabled. */
export function PlanFields({
  draft,
  set,
  full = false,
  locked = () => false
}: {
  draft: Pick<TaskDraft, 'prompt' | 'criteria' | 'kind'> & Partial<Pick<TaskDraft, 'difficulty' | 'effort' | 'affectedPaths'>>
  set: (field: 'prompt' | 'criteria' | 'kind' | 'difficulty' | 'effort' | 'affectedPaths', value: string) => void
  full?: boolean
  locked?: (field: EditField) => boolean
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <>
      <Field kind="textarea" className="plan-edit-prompt" label={t('plan.edit.field.prompt')} rows={5} value={draft.prompt} disabled={locked('prompt')} onChange={(e) => set('prompt', e.target.value)} />
      <Field kind="textarea" label={t('plan.edit.field.criteria')} rows={3} value={draft.criteria} disabled={locked('criteria')} onChange={(e) => set('criteria', e.target.value)} />
      <Field
        kind="select"
        label={t('plan.edit.field.kind')}
        value={draft.kind}
        disabled={locked('kind')}
        options={[{ value: '', label: t('plan.edit.field.kindAuto') }, ...TASK_KINDS.map((k) => ({ value: k, label: t(`plan.kind.${k}`) }))]}
        onChange={(e) => set('kind', e.target.value)}
      />
      {full && (
        <>
          <Field
            kind="select"
            label={t('plan.edit.field.difficulty')}
            value={draft.difficulty ?? ''}
            disabled={locked('difficulty')}
            options={[{ value: '', label: t('plan.edit.field.difficultyNone') }, ...DIFFICULTIES.map((d) => ({ value: d, label: t(`plan.task.difficulty.${d}`) }))]}
            onChange={(e) => set('difficulty', e.target.value)}
          />
          <Field
            kind="select"
            label={t('plan.edit.field.effort')}
            value={draft.effort ?? ''}
            disabled={locked('effort')}
            options={[{ value: '', label: t('plan.edit.field.effortNone') }, ...EFFORTS.map((e) => ({ value: e, label: e }))]}
            onChange={(e) => set('effort', e.target.value)}
          />
          <Field
            kind="textarea"
            className="plan-edit-paths"
            label={t('plan.edit.field.affectedPaths')}
            rows={3}
            value={draft.affectedPaths ?? ''}
            disabled={locked('affectedPaths')}
            onChange={(e) => set('affectedPaths', e.target.value)}
          />
        </>
      )}
    </>
  )
}

export function TaskEditModal({
  door,
  task,
  tasks,
  edit,
  onClose,
  onSaved
}: {
  door: OrchDoor
  /** The Task's full record (taskEdit.ts loadTaskInfo). */
  task: Task
  /** The plan's Tasks: the dependency choices. */
  tasks: readonly JobTask[]
  edit: TaskEdit
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [before] = useState(() => draftOf(task))
  const [draft, setDraft] = useState(before)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The edit may have gone through on a Runtime whose answer was lost: not sent again from this form. */
  const [locked, setLocked] = useState(false)
  const set = (field: keyof TaskDraft, value: string | string[]): void => setDraft((d) => ({ ...d, [field]: value }))
  const off = (field: EditField): boolean => busy || !canEdit(edit, field)
  const reason = edit.fields === 'all' ? null : t(edit.reason)
  const changes = editArgsOf(before, draft)
  const nothing = Object.keys(changes).length === 0

  const save = async (): Promise<void> => {
    if (busy || locked || nothing) return
    setBusy(true)
    setError(null)
    try {
      const reply = await door.command('task-update', { id: task.id, ...changes })
      if (reply.status >= 400) {
        // The Host's own refusal ("has started already…", "would make it wait on itself"), else the generic line
        const said = (reply.body as { error?: unknown } | null)?.error
        setError(replyNote(reply, t as never, typeof said === 'string' ? said : t('plan.edit.failed')))
        if (isOutcomeUnknown(reply)) setLocked(true)
        return
      }
      onSaved()
    } catch {
      setError(t('plan.edit.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('plan.edit.title')}
      size="lg"
      closeLabel={t('common.cancel')}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={busy || locked || nothing} title={nothing ? t('plan.edit.nothing') : undefined} onClick={() => void save()}>
            {t('plan.edit.save')}
          </Button>
        </>
      }
    >
      <div className="form-stack plan-edit">
        {reason !== null && (
          <p className="ui-field__hint plan-edit-why" role="note">
            <Icon name="lock" size={14} />
            {reason}
          </p>
        )}
        <Field label={t('plan.edit.field.title')} value={draft.title} disabled={off('title')} title={off('title') ? reason ?? undefined : undefined} onChange={(e) => set('title', e.target.value)} />
        <Field kind="textarea" label={t('plan.edit.field.spec')} rows={4} value={draft.spec} disabled={off('spec')} title={off('spec') ? reason ?? undefined : undefined} onChange={(e) => set('spec', e.target.value)} />
        <PlanFields draft={draft} set={set} full locked={off} />
        <DepsPicker
          label={t('plan.edit.field.deps')}
          addLabel={t('plan.edit.field.depsAdd')}
          tasks={tasks.filter((tk) => tk.id !== task.id)}
          deps={draft.deps}
          disabled={off('deps')}
          onChange={(deps) => set('deps', deps)}
        />
        {error && (
          <p className="ui-field__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
