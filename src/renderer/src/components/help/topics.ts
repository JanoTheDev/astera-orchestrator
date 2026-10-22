// T30: the help topics. Text is i18n keys (core/i18n/messages/<locale>/help.ts); the shortcuts topic is built from the
// key registry with the user's current bindings, so it cannot drift from what the keys really do.
import type { MessageKey } from '../../../../core/i18n'

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

export type TopicBlock =
  | { kind: 'text'; key: MessageKey }
  | { kind: 'term'; name: MessageKey; def: MessageKey }
  | { kind: 'shortcuts' }

export interface Topic {
  id: string
  title: MessageKey
  blocks: TopicBlock[]
}

const text = (...keys: string[]): TopicBlock[] => keys.map((key) => ({ kind: 'text', key: key as MessageKey }))
const TERMS = ['plan', 'step', 'task', 'attempt', 'lead', 'question', 'worktree', 'delivery', 'service']

export const TOPICS: readonly Topic[] = [
  { id: 'start', title: 'help.start.title', blocks: text('help.start.1', 'help.start.2', 'help.start.3', 'help.start.4') },
  { id: 'plans', title: 'help.plans.title', blocks: text('help.plans.1', 'help.plans.2', 'help.plans.3', 'help.plans.4') },
  { id: 'agents', title: 'help.agents.title', blocks: text('help.agents.1', 'help.agents.2', 'help.agents.3') },
  { id: 'accounts', title: 'help.accounts.title', blocks: text('help.accounts.1', 'help.accounts.2', 'help.accounts.3') },
  { id: 'delivery', title: 'help.delivery.title', blocks: text('help.delivery.1', 'help.delivery.2', 'help.delivery.3') },
  { id: 'shortcuts', title: 'help.shortcuts.title', blocks: [...text('help.shortcuts.1'), { kind: 'shortcuts' }] },
  {
    id: 'glossary',
    title: 'help.glossary.title',
    blocks: [
      ...text('help.glossary.1'),
      ...TERMS.map((id): TopicBlock => ({ kind: 'term', name: `help.term.${id}.name` as MessageKey, def: `help.term.${id}.def` as MessageKey }))
    ]
  }
]

/** One shortcut line of the shortcuts topic: the action's name and its keys as the user has them. */
export interface ShortcutLine {
  name: string
  keys: string[]
}

/** Every sentence of a topic as plain strings, in reading order: the search text and the word count are made from it. */
export function topicLines(topic: Topic, t: Translate, shortcuts: readonly ShortcutLine[]): string[] {
  return [
    t(topic.title),
    ...topic.blocks.flatMap((b) =>
      b.kind === 'text' ? [t(b.key)] : b.kind === 'term' ? [t(b.name), t(b.def)] : shortcuts.flatMap((s) => [s.name, ...s.keys])
    )
  ]
}

/** The topics that contain every word typed (any order, any case); no text keeps them all. */
export function filterTopics(topics: readonly Topic[], query: string, t: Translate, shortcuts: readonly ShortcutLine[]): Topic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...topics]
  return topics.filter((topic) => {
    const hay = topicLines(topic, t, shortcuts).join('\n').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
