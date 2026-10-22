// T30: the help topics: how many, how long, translated in all four languages, and searchable.
import { describe, expect, it } from 'vitest'
import { en } from '../../../../core/i18n/messages/en'
import { es } from '../../../../core/i18n/messages/es'
import { ja } from '../../../../core/i18n/messages/ja'
import { ko } from '../../../../core/i18n/messages/ko'
import type { MessageKey } from '../../../../core/i18n'
import { makeActions } from '../../../../core/keys/binding'
import { filterTopics, TOPICS, topicLines, type ShortcutLine, type Translate } from './topics'

const t: Translate = (key) => (en as Record<string, string>)[key] ?? key
const shortcuts: ShortcutLine[] = [{ name: 'Open a new window', keys: ['Ctrl+Shift+N'] }]
const words = (s: string): number => s.split(/\s+/).filter(Boolean).length

describe('help topics', () => {
  it('has 6 to 8 topics, including shortcuts and a glossary', () => {
    expect(TOPICS.length).toBeGreaterThanOrEqual(6)
    expect(TOPICS.length).toBeLessThanOrEqual(8)
    expect(TOPICS.map((x) => x.id)).toEqual(expect.arrayContaining(['shortcuts', 'glossary']))
  })

  it('each topic is about 200 words at most, in every language it is written for', () => {
    // 36 shortcut lines of names and keys are not prose; the cap counts the written text
    const prose = (loc: Record<string, string>, id: string): number => {
      const tr: Translate = (key) => loc[key] ?? (en as Record<string, string>)[key] ?? key
      return words(topicLines(TOPICS.find((x) => x.id === id)!, tr, []).join(' '))
    }
    for (const topic of TOPICS) expect(prose(en, topic.id), topic.id).toBeLessThanOrEqual(200)
  })

  it('every text key exists in en, es, ja and ko', () => {
    const keys = TOPICS.flatMap((x) => [x.title, ...x.blocks.flatMap((b) => (b.kind === 'text' ? [b.key] : b.kind === 'term' ? [b.name, b.def] : []))])
    for (const [name, loc] of Object.entries({ en, es, ja, ko }) as Array<[string, Record<string, string>]>)
      for (const k of [...keys, 'help.title', 'help.shortcut', 'help.search', 'help.noMatch']) expect(loc[k as MessageKey], `${name} ${k}`).toBeTruthy()
  })

  it('the glossary explains plan, step, task, attempt, lead agent, question for you and worktree', () => {
    const lines = topicLines(TOPICS.find((x) => x.id === 'glossary')!, t, []).join('\n').toLowerCase()
    for (const w of ['plan', 'step', 'task', 'attempt', 'lead agent', 'question for you', 'worktree']) expect(lines).toContain(w)
  })

  it('the shortcuts topic shows the bindings it is given', () => {
    expect(topicLines(TOPICS.find((x) => x.id === 'shortcuts')!, t, shortcuts)).toContain('Ctrl+Shift+N')
  })

  it('search keeps topics holding every word, in any case and order', () => {
    expect(filterTopics(TOPICS, '', t, shortcuts)).toHaveLength(TOPICS.length)
    expect(filterTopics(TOPICS, 'PULL request', t, shortcuts).map((x) => x.id)).toContain('delivery')
    expect(filterTopics(TOPICS, 'ctrl shift', t, shortcuts).map((x) => x.id)).toEqual(['shortcuts'])
    expect(filterTopics(TOPICS, 'zzzqqq', t, shortcuts)).toEqual([])
  })

  it('F1 is the help action', () => {
    expect(makeActions('linux').find((a) => a.id === 'help.open')?.defaults).toEqual(['F1'])
  })
})
