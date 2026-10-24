import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { setCached } from '../lib/readCache'
import { useSetting } from './useSetting'

type Setter = (v: number | undefined | ((p: number | undefined) => number | undefined)) => void
let set: Setter = () => {}
function Probe({ k }: { k: string }): React.JSX.Element {
  const [v, s] = useSetting<number>(k, () => Promise.resolve(0))
  set = s as Setter
  return createElement('span', null, String(v))
}
const html = (k: string): string => renderToStaticMarkup(createElement(Probe, { k }))

describe('useSetting', () => {
  it('has no value before any read, the cached one after', () => {
    expect(html('first')).toBe('<span>undefined</span>')
    setCached('setting:first', 3)
    expect(html('first')).toBe('<span>3</span>')
  })

  it('a saved value is what the next open shows', () => {
    html('saved')
    set(7)
    expect(html('saved')).toBe('<span>7</span>')
  })

  it('a functional update starts from the shown value', () => {
    setCached('setting:fn', 2)
    html('fn')
    set((p) => (p ?? 0) + 1)
    expect(html('fn')).toBe('<span>3</span>')
  })
})
