// The change map: the changed files grouped by area, each with its changed symbols, and the imports between them. The
// graph is the picture; the list says the same in rows and is what a narrow tab, a big change or a screen reader gets.
// Picking a file or a symbol in either scrolls the code panel to it.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEdge, ChangeMapFile, ChangeSymbol } from '../../../../core/review/changeMap'
import { layoutAreas, linkPath, type AreaBox } from '../../../../core/understanding/flowLayout'
import { useI18n } from '../../i18n/I18nProvider'
import { changeLetter } from '../explorerChanged'
import { FlowLinks } from '../FlowDiagram'
import { Button, Icon, type IconName } from '../ui'
import type { ReviewArea } from './reviewModel'

/** Past this many files the graph is not drawn: the list carries them. */
export const MAP_MAX_FILES = 40

const COL_W = 236
const HEAD_H = 28
const ROW_H = 20
const MAX_ROWS = 5
const FOOT = 6

const nodeHeight = (symbols: number): number => HEAD_H + Math.min(symbols, MAX_ROWS) * ROW_H + (symbols > MAX_ROWS ? ROW_H : 0) + FOOT

const CHANGE_ICON: Record<ChangeSymbol['change'], IconName> = { added: 'add', modified: 'edit', removed: 'remove' }

const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

export interface MapPick {
  onFile: (path: string) => void
  onSymbol: (symbol: ChangeSymbol) => void
}

export function SymbolMark({ change }: { change: ChangeSymbol['change'] }): React.JSX.Element {
  const { t } = useI18n()
  // the glyph is the second cue next to the colour: plus, pencil, minus
  return (
    <span className={`rv-mark is-${change}`}>
      <Icon name={CHANGE_ICON[change]} size={14} label={t(`review.change.${change}`)} />
    </span>
  )
}

function FileStatus({ file }: { file: ChangeMapFile }): React.JSX.Element {
  const { t } = useI18n()
  const status = file.status === 'deleted' ? 'deleted' : file.status === 'added' ? 'added' : file.status === 'renamed' ? 'renamed' : 'modified'
  return (
    <span className={`changed-file-status is-${status}`} title={t(`jobs.changes.status.${status}` as never)}>
      {changeLetter(status)}
    </span>
  )
}

export function ChangeMapView({
  areas,
  edges,
  mode,
  activePath,
  pick
}: {
  areas: ReviewArea[]
  edges: ChangeEdge[]
  mode: 'map' | 'list'
  /** The file the code panel is on: marked in the map. */
  activePath: string | null
  pick: MapPick
}): React.JSX.Element {
  const { t } = useI18n()
  const count = areas.reduce((n, a) => n + a.files.length, 0)
  const graph = mode === 'map' && count <= MAP_MAX_FILES
  return (
    <div className={`rv-map${graph ? ' has-graph' : ''}`}>
      {graph && <MapGraph areas={areas} edges={edges} activePath={activePath} pick={pick} />}
      {mode === 'map' && !graph && <p className="modal-hint">{t('review.map.tooBig', { count })}</p>}
      <MapList areas={areas} edges={edges} activePath={activePath} pick={pick} />
    </div>
  )
}

function MapGraph({ areas, edges, activePath, pick }: { areas: ReviewArea[]; edges: ChangeEdge[]; activePath: string | null; pick: MapPick }): React.JSX.Element {
  const { t } = useI18n()
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hot, setHot] = useState<string | null>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(
    () =>
      layoutAreas(
        areas.map((a) => ({ id: a.area, items: a.files.map((f) => ({ id: f.file.path, h: nodeHeight(f.symbols.length) })) })),
        { width: Math.max(width, COL_W), colW: COL_W, gap: 24, headH: 24, pad: 8 }
      ),
    [areas, width]
  )
  const boxOf = useMemo(() => new Map(layout.boxes.map((b) => [b.id, b])), [layout])
  // a link loops out of the right edge: leave room for it
  const w = layout.width + 32
  const links = edges.flatMap((e) => {
    const a = boxOf.get(e.from)
    const b = boxOf.get(e.to)
    if (!a || !b) return []
    const lit = hot === null ? '' : hot === e.from || hot === e.to ? ' is-hot' : ' is-dim'
    return [{ key: `${e.from}>${e.to}`, d: linkPath(a, b), className: `rv-link${e.new ? ' is-new' : ''}${lit}`, accent: e.new }]
  })
  const linked = (path: string): boolean => hot !== null && (hot === path || edges.some((e) => (e.from === hot && e.to === path) || (e.to === hot && e.from === path)))

  return (
    <div className="rv-graph" ref={wrap}>
      {width > 0 && (
        <div className="rv-graph__canvas" style={{ width: w, height: layout.height }}>
          {layout.groups.map((g) => (
            <div key={g.id} className="rv-area" style={box(g)}>
              <span className="rv-area__label" title={g.id || t('review.map.root')}>
                {g.id || t('review.map.root')}
              </span>
            </div>
          ))}
          <FlowLinks width={w} height={layout.height} links={links} />
          {areas.flatMap((a) =>
            a.files.map((f) => {
              const b = boxOf.get(f.file.path)
              if (!b) return null
              const shown = f.symbols.slice(0, MAX_ROWS)
              const cls = ['rv-node', activePath === f.file.path ? 'is-active' : '', linked(f.file.path) ? 'is-linked' : '', hot !== null && !linked(f.file.path) ? 'is-dim' : '']
              return (
                <div
                  key={f.file.path}
                  className={cls.filter(Boolean).join(' ')}
                  style={box(b)}
                  onMouseEnter={() => setHot(f.file.path)}
                  onMouseLeave={() => setHot(null)}
                  onFocus={() => setHot(f.file.path)}
                  onBlur={() => setHot(null)}
                >
                  <Button
                    variant="ghost"
                    className="rv-node__head"
                    title={f.file.path}
                    aria-label={t('review.map.fileLabel', { path: f.file.path, add: f.file.additions, del: f.file.deletions })}
                    onClick={() => pick.onFile(f.file.path)}
                  >
                    <FileStatus file={f.file} />
                    <span className="rv-node__name">{baseName(f.file.path)}</span>
                    <span className="rv-counts" aria-hidden="true">
                      <span className="rv-add">+{f.file.additions}</span> <span className="rv-del">−{f.file.deletions}</span>
                    </span>
                  </Button>
                  {shown.map((s) => (
                    <Button key={`${s.kind}:${s.name}:${s.change}`} variant="ghost" className="rv-node__sym" title={s.name} onClick={() => pick.onSymbol(s)}>
                      <SymbolMark change={s.change} />
                      <span className="rv-sym__name">{s.name}</span>
                    </Button>
                  ))}
                  {f.symbols.length > MAX_ROWS && <span className="rv-node__more">{t('review.map.more', { count: f.symbols.length - MAX_ROWS })}</span>}
                </div>
              )
            })
          )}
        </div>
      )}
      <p className="rv-legend" aria-hidden="true">
        <span className="rv-legend__item">
          <span className="rv-legend__line" />
          {t('review.map.legend.import')}
        </span>
        <span className="rv-legend__item">
          <span className="rv-legend__line is-new" />
          {t('review.map.legend.new')}
        </span>
      </p>
    </div>
  )
}

const box = (b: AreaBox): React.CSSProperties => ({ left: b.x, top: b.y, width: b.w, height: b.h })

function MapList({ areas, edges, activePath, pick }: { areas: ReviewArea[]; edges: ChangeEdge[]; activePath: string | null; pick: MapPick }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <ul className="rv-list" aria-label={t('review.map.label')}>
      {areas.map((a) => (
        <li key={a.area} className="rv-list__area">
          <span className="rv-area__label">{a.area || t('review.map.root')}</span>
          <ul>
            {a.files.map((f) => {
              const out = edges.filter((e) => e.from === f.file.path)
              return (
                <li key={f.file.path} className={`rv-list__file${activePath === f.file.path ? ' is-active' : ''}`}>
                  <Button
                    variant="ghost"
                    className="rv-list__head"
                    aria-label={t('review.map.fileLabel', { path: f.file.path, add: f.file.additions, del: f.file.deletions })}
                    onClick={() => pick.onFile(f.file.path)}
                  >
                    <FileStatus file={f.file} />
                    <span className="rv-list__path">{f.file.path}</span>
                    <span className="rv-counts" aria-hidden="true">
                      <span className="rv-add">+{f.file.additions}</span> <span className="rv-del">−{f.file.deletions}</span>
                    </span>
                  </Button>
                  {f.symbols.length > 0 && (
                    <ul className="rv-list__syms">
                      {f.symbols.map((s) => (
                        <li key={`${s.kind}:${s.name}:${s.change}`}>
                          <Button variant="ghost" className="rv-list__sym" onClick={() => pick.onSymbol(s)}>
                            <SymbolMark change={s.change} />
                            <span className="rv-sym__name">{s.name}</span>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {out.length > 0 && (
                    <p className="rv-list__imports">
                      <Icon name="open" size={14} />
                      {t('review.list.imports', {
                        files: out.map((e) => (e.new ? `${baseName(e.to)} (${t('review.list.newImport')})` : baseName(e.to))).join(', ')
                      })}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ul>
  )
}
