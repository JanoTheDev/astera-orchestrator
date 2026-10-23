// The GitHub repos the skills finder searches: the default one always, then the person's (owner/repo, checked by
// repoProblem before it is sent; the backend checks again).
import { useEffect, useState } from 'react'
import type { SkillRepos } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { Button, Chip, Icon, IconButton, Input } from '../ui'
import { normaliseRepo, repoProblem } from './finderLogic'

const detailOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function SkillReposEditor({ onChange }: { onChange: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [repos, setRepos] = useState<SkillRepos | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = (): void => {
    setLoadError(null)
    window.api.extensions.skillReposGet().then(setRepos, (err) => setLoadError(detailOf(err)))
  }
  useEffect(load, [])

  const save = async (added: string[]): Promise<boolean> => {
    setSaving(true)
    try {
      const r = await window.api.extensions.skillReposSet(added)
      if (!r.ok) {
        toast.error(t('finder.repos.saveFailed', { detail: r.message }))
        return false
      }
      setRepos(r.repos)
      onChange()
      return true
    } catch (err) {
      toast.error(t('finder.repos.saveFailed', { detail: detailOf(err) }))
      return false
    } finally {
      setSaving(false)
    }
  }

  if (loadError !== null)
    return (
      <div className="finder__state" role="alert">
        <span>{t('finder.repos.loadFailed', { detail: loadError })}</span>
        <Button size="sm" variant="ghost" icon={<Icon name="refresh" />} onClick={load}>
          {t('finder.retry')}
        </Button>
      </div>
    )
  if (repos === null) return <div className="finder__state" aria-busy="true">{t('finder.loading')}</div>

  const problem = repoProblem(draft, [repos.default, ...repos.added])
  const add = async (): Promise<void> => {
    setTried(true)
    if (problem !== null || saving) return
    if (await save([...repos.added, normaliseRepo(draft)])) {
      setDraft('')
      setTried(false)
    }
  }
  const errorId = 'finder-repo-error'
  const showProblem = tried && draft.trim() !== '' && problem !== null

  return (
    <div className="finder__repos">
      <span className="finder__heading">{t('finder.repos.title')}</span>
      <p className="finder__note">{t('finder.repos.hint', { default: repos.default })}</p>
      <ul className="finder__list">
        <li className="finder__item">
          <span className="finder__meta">{repos.default}</span>
          <span className="finder__actions">
            <Chip>{t('finder.repos.default')}</Chip>
          </span>
        </li>
        {repos.added.map((r) => (
          <li key={r} className="finder__item">
            <span className="finder__meta">{r}</span>
            <span className="finder__actions">
              <IconButton
                size="sm"
                icon={<Icon name="delete" size={14} />}
                label={t('finder.repos.removeLabel', { repo: r })}
                disabled={saving}
                onClick={() => void save(repos.added.filter((x) => x !== r))}
              />
            </span>
          </li>
        ))}
      </ul>
      <form
        className="finder__search"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <Input
          aria-label={t('finder.repos.input')}
          placeholder="owner/repo"
          spellCheck={false}
          value={draft}
          aria-invalid={showProblem || undefined}
          aria-describedby={showProblem ? errorId : undefined}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" icon={<Icon name="add" />} loading={saving} disabled={draft.trim() === ''}>
          {t('finder.repos.add')}
        </Button>
      </form>
      {showProblem && (
        <p id={errorId} className="finder__note finder__note--error" role="alert">
          {t(problem === 'format' ? 'finder.repos.format' : 'finder.repos.duplicate')}
        </p>
      )}
    </div>
  )
}
