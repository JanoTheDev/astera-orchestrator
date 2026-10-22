import type { RunConfig } from '../../../core/run/types'
import { addableTargets, type RefField } from '../../../core/run/launch'
import { runTypeIcon } from '../../../core/run/typeIcon'
import { useI18n } from '../i18n/I18nProvider'
import { FileIcon } from './FileIcon'
import { Chip, Icon, IconButton, Menu } from './ui'

/** A list of other run configurations, as chips. Used twice with the same meaning — "these
 *  configurations, named by id" — and two different readings of the order:
 *
 *  - the form's **Before launch** section, where the order is the order they run in;
 *  - a **compound's members**, where it is display only, because members start together.
 *
 *  The add picker offers `addableTargets`' answer, so a configuration that would create a cycle is
 *  never offered rather than offered and then refused at ▶. A chip whose id resolves to nothing is
 *  still drawn, showing the id — the tree marks that configuration ⚠, and hiding the chip would leave
 *  the user nothing to remove. */
export function ConfigRefList({
  ids,
  all,
  hostId,
  field,
  onChange
}: {
  ids: readonly string[]
  /** The dialog's whole draft list — a configuration added with ＋ a moment ago is a valid target */
  all: readonly RunConfig[]
  hostId: string
  /** Which of the host's own reference fields `ids` is — a compound has both, so addableTargets has to
   *  be told which one it is probing rather than guessing it from the host's kind. */
  field: RefField
  onChange: (ids: string[]) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const targets = addableTargets(all, hostId, field, ids)

  return (
    <div className="ref-list">
      {ids.map((id) => {
        const c = all.find((x) => x.id === id)
        return (
          <Chip tone={c ? 'neutral' : 'danger'} className={`ref-chip${c ? '' : ' broken'}`} key={id}>
            {c ? <FileIcon {...runTypeIcon(c.type)} /> : null}
            <span className="ref-chip-name">{c ? c.name : id}</span>
            <IconButton
              className="ref-chip-x"
              size="sm"
              icon={<Icon name="close" size={14} />}
              label={`${t('run.ref.remove')}: ${c ? c.name : id}`}
              onClick={() => onChange(ids.filter((x) => x !== id))}
            />
          </Chip>
        )
      })}
      <Menu
        label={t('run.ref.add')}
        trigger={{ icon: <Icon name="add" size={14} />, children: t('run.ref.add'), size: 'sm', variant: 'ghost', className: 'ref-add' }}
        items={
          targets.length === 0
            ? [{ id: 'none', label: t('run.ref.none'), disabled: true, onSelect: () => {} }]
            : targets.map((c) => ({
                id: c.id,
                label: c.name,
                icon: <FileIcon {...runTypeIcon(c.type)} />,
                onSelect: () => onChange([...ids, c.id])
              }))
        }
      />
    </div>
  )
}
