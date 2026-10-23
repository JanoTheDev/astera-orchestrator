import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '../types'
import { sourceCard, sourceReadyToast, titlebarView } from './sourceView'

const sourceBuild = { commit: 'abc1234', selfInstall: true }
const commits = [{ sha: 'a'.repeat(40), subject: 'fix: one' }, { sha: 'b'.repeat(40), subject: 'feat: two' }]
const src = (s: UpdateStatus): UpdateStatus => ({ ...s, sourceBuild })
const withChanges = { behind: 25, commits, target: 'deadbeefcafe' }

describe('titlebarView', () => {
  it('shows nothing for init and uptodate, on both channels', () => {
    expect(titlebarView(null)).toEqual({ kind: 'none' })
    expect(titlebarView({ state: 'init' })).toEqual({ kind: 'none' })
    expect(titlebarView(src({ state: 'uptodate', version: 'abc1234' }))).toEqual({ kind: 'none' })
    // A dev run answers update:status with disabled; that is no error to show.
    expect(titlebarView({ state: 'disabled', reason: 'unpackaged' })).toEqual({ kind: 'none' })
  })
  it('counts new changes for a source build', () => {
    expect(titlebarView(src({ state: 'available', version: 'deadbee', source: withChanges }))).toEqual({
      kind: 'text',
      message: { key: 'update.tb.sourceChanges', params: { count: 25 } }
    })
  })
  it('names the build step, and the heavy-job wait in its own words', () => {
    const building = (step: UpdateStatus['step']): TitlebarResult =>
      titlebarView(src({ state: 'building', step, message: `step ${step}` })) as TitlebarResult
    for (const step of ['cloning', 'installing', 'building'] as const)
      expect(building(step).message).toEqual({ key: 'update.tb.building', params: { step: `step ${step}` } })
    expect(building('waiting').message.key).toBe('update.tb.buildWaiting')
  })
  it('offers a restart button without a version number once built', () => {
    expect(titlebarView(src({ state: 'downloaded', version: '1.0.0-deadbee', source: withChanges }))).toEqual({
      kind: 'button',
      message: { key: 'update.tb.restartSource' }
    })
  })
  it('shows an error label', () => {
    expect(titlebarView(src({ state: 'error', message: 'boom' }))).toEqual({ kind: 'error', message: { key: 'update.tb.error' } })
  })
  it('leaves the releases channel wording unchanged', () => {
    expect(titlebarView({ state: 'available', version: '1.2.3' })).toEqual({
      kind: 'text',
      message: { key: 'update.tb.available', params: { version: '1.2.3' } }
    })
    expect(titlebarView({ state: 'downloaded', version: '1.2.3' })).toEqual({
      kind: 'button',
      message: { key: 'update.tb.restartInstallVersion', params: { version: '1.2.3' } }
    })
    expect(titlebarView({ state: 'downloading', percent: 40 })).toEqual({
      kind: 'text',
      message: { key: 'update.tb.downloading', params: { percent: 40 } }
    })
    expect(titlebarView({ state: 'manual', version: '1.2.3' }).kind).toBe('button')
    expect(titlebarView({ state: 'checking' }).kind).toBe('text')
    expect(titlebarView({ state: 'error' }).kind).toBe('error')
  })
})
type TitlebarResult = Extract<ReturnType<typeof titlebarView>, { message: unknown }>

describe('sourceCard', () => {
  it('maps each state to a phase', () => {
    expect(sourceCard(src({ state: 'uptodate' })).phase).toBe('upToDate')
    expect(sourceCard(src({ state: 'building', step: 'building' })).phase).toBe('building')
    expect(sourceCard(src({ state: 'error', message: 'x' }))).toMatchObject({ phase: 'error', error: 'x' })
  })
  it('lists the commits, counts the rest and offers Build now', () => {
    const c = sourceCard(src({ state: 'available', source: withChanges }))
    expect(c).toMatchObject({ commit: 'abc1234', phase: 'changes', behind: 25, more: 23, showBuild: true, showRestart: false })
    expect(c.commits).toHaveLength(2)
  })
  it('offers Restart once built', () => {
    expect(sourceCard(src({ state: 'downloaded', source: withChanges }))).toMatchObject({ showRestart: true, showBuild: false })
  })
  it('only tells on a build that cannot install itself', () => {
    const u: UpdateStatus = { state: 'available', source: withChanges, sourceBuild: { commit: 'abc1234', selfInstall: false } }
    expect(sourceCard(u)).toMatchObject({ manualOnly: true, showBuild: false, showRestart: false, behind: 25 })
  })
})

describe('sourceReadyToast', () => {
  const built = src({ state: 'downloaded', version: '1.0.0-deadbee', source: withChanges })
  it('announces a built target once', () => {
    const t = sourceReadyToast(built, null)
    expect(t).toMatchObject({ target: 'deadbeefcafe', message: { key: 'update.ui.toastReady', params: { count: 25 } }, action: 'update.ui.restart' })
    expect(sourceReadyToast(built, 'deadbeefcafe')).toBeNull()
  })
  it('stays quiet for other states and for the releases channel', () => {
    expect(sourceReadyToast(src({ state: 'available', source: withChanges }), null)).toBeNull()
    expect(sourceReadyToast({ state: 'downloaded', version: '1.2.3' }, null)).toBeNull()
  })
})
