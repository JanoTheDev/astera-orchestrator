// T30: the in-app help. Opened by F1 (`help.open`), the Manage menu and the command palette. A topic list on the left
// with a search field over it, the chosen topic on the right. Text is i18n; the shortcuts topic is read from the key
// registry with the user's own bindings (topics.ts).
import { useMemo, useState } from 'react'
import { formatChord, resolveBindings } from '../../../../core/keys/binding'
import { ACTIONS } from '../../lib/actions'
import { useI18n } from '../../i18n/I18nProvider'
import { shortcutRows } from '../ShortcutSettings'
import { Button, Input, Kbd, Modal } from '../ui'
import { filterTopics, TOPICS, type ShortcutLine, type Topic, type TopicBlock } from './topics'
import './help.css'

export function HelpPanel({ keyOverrides, onClose }: { keyOverrides: Record<string, string[]>; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(TOPICS[0].id)
  // F1 itself is a shortcut of the registry: the same rows Settings > Shortcuts edits, with the keys as they are now.
  const shortcuts = useMemo<ShortcutLine[]>(
    () => shortcutRows(resolveBindings(keyOverrides, ACTIONS), t).map((r) => ({ name: r.name, keys: r.keys })),
    [keyOverrides, t]
  )
  const shown = useMemo(() => filterTopics(TOPICS, query, t, shortcuts), [query, t, shortcuts])
  const topic = shown.find((x) => x.id === picked) ?? shown[0]

  return (
    <Modal title={t('help.title')} size="lg" onClose={onClose} closeLabel={t('help.close')}>
      <div className="help">
        <nav className="help-topics" aria-label={t('help.topics')}>
          <Input type="search" value={query} placeholder={t('help.search')} aria-label={t('help.search')} onChange={(e) => setQuery(e.target.value)} />
          {shown.map((x) => (
            <Button key={x.id} variant="ghost" className="help-topic" aria-current={x === topic ? 'true' : undefined} onClick={() => setPicked(x.id)}>
              {t(x.title)}
            </Button>
          ))}
        </nav>
        <article className="help-body" aria-live="polite">
          {topic ? <TopicView topic={topic} shortcuts={shortcuts} /> : <p className="help-empty">{t('help.noMatch')}</p>}
        </article>
      </div>
    </Modal>
  )
}

function TopicView({ topic, shortcuts }: { topic: Topic; shortcuts: readonly ShortcutLine[] }): React.JSX.Element {
  const { t } = useI18n()
  const block = (b: TopicBlock, i: number): React.JSX.Element => {
    if (b.kind === 'text') return <p key={i}>{t(b.key)}</p>
    if (b.kind === 'term')
      return (
        <div key={i} className="help-term">
          <dt>{t(b.name)}</dt>
          <dd>{t(b.def)}</dd>
        </div>
      )
    return (
      <ul key={i} className="help-keys">
        {shortcuts.map((s, k) => (
          <li key={k}>
            <span>{s.name}</span>
            <span className="help-chords">{s.keys.length > 0 ? s.keys.map((c) => <Kbd key={c}>{c}</Kbd>) : <em>{t('help.shortcuts.off')}</em>}</span>
          </li>
        ))}
      </ul>
    )
  }
  // Consecutive terms share one definition list.
  const groups: Array<TopicBlock | TopicBlock[]> = []
  for (const b of topic.blocks) {
    const last = groups[groups.length - 1]
    if (b.kind === 'term' && Array.isArray(last)) last.push(b)
    else groups.push(b.kind === 'term' ? [b] : b)
  }
  return (
    <>
      <h3>{t(topic.title)}</h3>
      {groups.map((g, i) => (Array.isArray(g) ? <dl key={i}>{g.map(block)}</dl> : block(g, i)))}
    </>
  )
}
