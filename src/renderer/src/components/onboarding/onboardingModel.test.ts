import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '../../../../core/types'
import {
  ONBOARDING_STEPS, canNext, canSkipStep, cliBannerShown, donePrimary, doneNotes, exitEffects, isOnboardingShown, nextStep, prevStep, replayStart,
  resumeStep, showUpdateChoice, type OnboardingStep
} from './onboardingModel'

describe('onboardingModel', () => {
  it('has the six steps in order', () => {
    expect(ONBOARDING_STEPS).toEqual(['welcome', 'tools', 'accounts', 'project', 'preferences', 'done'])
    expect(nextStep('welcome')).toBe('tools')
    expect(nextStep('done')).toBe('done')
    expect(prevStep('tools')).toBe('welcome')
    expect(prevStep('welcome')).toBe('welcome')
  })

  it('shows on a first run or a replay, never while main has not answered or on an existing install', () => {
    expect(isOnboardingShown(false, false)).toBe(true)
    expect(isOnboardingShown(true, false)).toBe(false)
    expect(isOnboardingShown(null, false)).toBe(false)
    expect(isOnboardingShown(true, true)).toBe(true)
  })

  it('enables Next on Tools only with a CLI and on Accounts only with an account', () => {
    const none = { cliFound: false, accountCount: 0 }
    expect(canNext('welcome', none)).toBe(true)
    expect(canNext('tools', none)).toBe(false)
    expect(canNext('tools', { ...none, cliFound: true })).toBe(true)
    expect(canNext('accounts', { cliFound: true, accountCount: 0 })).toBe(false)
    expect(canNext('accounts', { cliFound: true, accountCount: 1 })).toBe(true)
    expect(canNext('project', none)).toBe(true)
    expect(canNext('preferences', none)).toBe(true)
    expect(canNext('done', none)).toBe(false)
  })

  it('resumes at a stored step, and at Welcome for none or an unknown one', () => {
    expect(resumeStep('accounts')).toBe('accounts')
    expect(resumeStep(null)).toBe('welcome')
    expect(resumeStep('bogus')).toBe('welcome')
  })

  it('offers the update choice only when the source channel can install by itself', () => {
    const base = { state: 'idle' } as unknown as UpdateStatus
    expect(showUpdateChoice(null)).toBe(false)
    expect(showUpdateChoice(base)).toBe(false)
    expect(showUpdateChoice({ ...base, sourceBuild: { commit: 'abc', selfInstall: false } })).toBe(false)
    expect(showUpdateChoice({ ...base, sourceBuild: { commit: 'abc', selfInstall: true } })).toBe(true)
  })

  it('marks onboarding done on every exit; only the Done buttons go somewhere', () => {
    expect(exitEffects('skip')).toEqual({ markDone: true, open: null })
    expect(exitEffects('start')).toEqual({ markDone: true, open: 'start' })
    expect(exitEffects('agents')).toEqual({ markDone: true, open: 'agents' })
  })

  it('lets Tools and Accounts be skipped for now, and nothing else (they have no Skip: they are passable or final)', () => {
    expect(canSkipStep('tools')).toBe(true)
    expect(canSkipStep('accounts')).toBe(true)
    for (const s of ['welcome', 'project', 'preferences', 'done'] as const) expect(canSkipStep(s)).toBe(false)
  })

  it('walks the whole flow with no CLI and no account by skipping the two blocked steps', () => {
    const ctx = { cliFound: false, accountCount: 0 }
    let step = 'welcome' as OnboardingStep
    const seen = [step]
    while (step !== 'done') {
      expect(canNext(step, ctx) || canSkipStep(step)).toBe(true)
      step = nextStep(step)
      seen.push(step)
    }
    expect(seen).toEqual([...ONBOARDING_STEPS])
  })

  it('says on the Done step what is missing and what that means', () => {
    expect(doneNotes({ cliFound: true, accountCount: 1 })).toEqual([])
    expect(doneNotes({ cliFound: false, accountCount: 0 })).toEqual(['noCli'])
    expect(doneNotes({ cliFound: true, accountCount: 0 })).toEqual(['noAccount'])
  })

  it('makes the Done primary Start only with a CLI; with none it goes back to Tools', () => {
    expect(donePrimary({ cliFound: true })).toBe('start')
    expect(donePrimary({ cliFound: false })).toBe('tools')
  })

  it('shows the no-CLI banner only once the answer is known, onboarding is closed and it was not dismissed', () => {
    const none = { claude: false, codex: false }
    expect(cliBannerShown({ cliInstalled: none, onboarding: false, dismissed: false })).toBe(true)
    expect(cliBannerShown({ cliInstalled: null, onboarding: false, dismissed: false })).toBe(false)
    expect(cliBannerShown({ cliInstalled: { ...none, codex: true }, onboarding: false, dismissed: false })).toBe(false)
    expect(cliBannerShown({ cliInstalled: none, onboarding: true, dismissed: false })).toBe(false)
    expect(cliBannerShown({ cliInstalled: none, onboarding: false, dismissed: true })).toBe(false)
  })

  it('a replay opened from the banner starts at Tools, from Settings at Welcome', () => {
    expect(replayStart(undefined)).toBe('welcome')
    expect(replayStart('tools')).toBe('tools')
  })
})
