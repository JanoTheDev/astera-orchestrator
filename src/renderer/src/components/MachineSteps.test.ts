import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MachineProgress } from '../../../core/types'
import { MachineSteps } from './MachineSteps'

// No I18nProvider under renderToStaticMarkup (see MarkdownPreview.test.ts): the hook answers with the key.
vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const render = (events: MachineProgress[]): string => renderToStaticMarkup(React.createElement(MachineSteps, { events }))

describe('MachineSteps', () => {
  it('draws a row per step from a progress stream, the last word on each step standing', () => {
    const html = render([
      { step: 'connect', state: 'running', line: 'Connecting to jon@box' },
      { step: 'connect', state: 'done', line: 'Connected to jon@box' },
      { step: 'detect', state: 'done', line: 'It runs Linux' },
      { step: 'installer', state: 'skipped', line: 'Already installed' },
      { step: 'upload', state: 'failed', line: 'Upload failed', stderrTail: 'scp: /tmp/x: No space left on device', fix: 'Free some disk space on the machine and run it again.' }
    ])
    expect(html.match(/<li>/g)).toHaveLength(7)
    expect(html).toContain('Connected to jon@box')
    expect(html).not.toContain('Connecting to jon@box')
    expect(html).toContain('It runs Linux')
    expect(html).toContain('remote.machines.state.skipped')
    expect(html).toContain('<pre class="pr-create-detail">scp: /tmp/x: No space left on device</pre>')
    expect(html).toContain('Free some disk space on the machine and run it again.')
    // The steps after the failure never ran: they wait.
    expect(html.match(/remote\.machines\.state\.waiting/g)).toHaveLength(3)
  })

  it('shows no tail or fix for a step that did not fail', () => {
    const html = render([{ step: 'verify', state: 'done', line: 'It answers', stderrTail: 'noise', fix: 'nothing' }])
    expect(html).toContain('It answers')
    expect(html).not.toContain('noise')
    expect(html).not.toContain('remote.machines.fix')
  })
})
