import { describe, it, expect } from 'vitest'
import React, { useContext } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActionsSlot, KeptViews } from './KeptViewHost'

const Probe = ({ id }: { id: string }): React.JSX.Element =>
  React.createElement('b', { id }, useContext(ActionsSlot) ? 'actions' : 'no-actions')

const render = (active: 'agents' | 'plans'): string =>
  renderToStaticMarkup(
    React.createElement(KeptViews, {
      ids: ['agents', 'plans'],
      active,
      slot: {} as HTMLElement,
      render: (id) => React.createElement(Probe, { id })
    })
  )

describe('KeptViews', () => {
  // The server renderer skips hidden Activity content (it mounts on the client), so a hidden view is absent here.
  it('renders only the visible view, with the header actions slot', () => {
    expect(render('plans')).toBe('<b id="plans">actions</b>')
    expect(render('agents')).toBe('<b id="agents">actions</b>')
  })
})
