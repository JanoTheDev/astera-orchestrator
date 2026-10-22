// The onboarding flow's rules, kept free of React so they can be tested: which steps there are, when Next is
// enabled, where a restart resumes, and what leaving does. Onboarding.tsx draws it.
import type { UpdateStatus } from '../../../../core/types'
import { isSourceStatus } from '../../../../core/update/sourceView'

export const ONBOARDING_STEPS = ['welcome', 'tools', 'accounts', 'project', 'preferences', 'done'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/** Shown on a first run (firstRunAsked false, never null: null is "main has not answered yet") or when Settings
 *  asked to show it again. */
export const isOnboardingShown = (firstRunAsked: boolean | null, replay: boolean): boolean =>
  firstRunAsked === false || replay

/** Where a first run resumes: the stored step if it is one of ours, else the start. */
export const resumeStep = (stored: string | null): OnboardingStep =>
  (ONBOARDING_STEPS as readonly string[]).includes(stored ?? '') ? (stored as OnboardingStep) : 'welcome'

export const stepIndex = (step: OnboardingStep): number => ONBOARDING_STEPS.indexOf(step)

export const nextStep = (step: OnboardingStep): OnboardingStep =>
  ONBOARDING_STEPS[Math.min(stepIndex(step) + 1, ONBOARDING_STEPS.length - 1)]

export const prevStep = (step: OnboardingStep): OnboardingStep => ONBOARDING_STEPS[Math.max(stepIndex(step) - 1, 0)]

export interface NextContext {
  /** Whether claude or codex is installed (existence, as App's entry gate reads it). */
  cliFound: boolean
  accountCount: number
}

/** Tools needs one CLI and Accounts one account; the project and preference steps can always be passed. */
export function canNext(step: OnboardingStep, ctx: NextContext): boolean {
  if (step === 'tools') return ctx.cliFound
  if (step === 'accounts') return ctx.accountCount > 0
  return step !== 'done'
}

/** The automatic-updates choice is offered only where the source channel can install by itself (an AppImage). */
export const showUpdateChoice = (u: UpdateStatus | null): boolean => isSourceStatus(u) && u?.sourceBuild?.selfInstall === true

export type OnboardingExit = 'skip' | 'start' | 'agents'

/** Every way out marks onboarding done (and the first-run question asked); only the Done step's buttons go somewhere. */
export function exitEffects(exit: OnboardingExit): { markDone: true; open: 'start' | 'agents' | null } {
  return { markDone: true, open: exit === 'skip' ? null : exit }
}
