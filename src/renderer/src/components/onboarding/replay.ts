// "Show onboarding again" (Settings > General). A tiny store rather than App state, like wall/wallView.ts: the
// Settings row sets it and App/Overlays read it, without threading a setter through the settings props.
import { useSyncExternalStore } from 'react'
import { replayStart, type OnboardingStep } from './onboardingModel'

let replaying = false
let startAt: OnboardingStep = 'welcome'
const listeners = new Set<() => void>()

/** `at`: the step a replay opens on (the no-CLI banner sends people to 'tools'); Welcome when omitted. */
export function setOnboardingReplay(on: boolean, at?: OnboardingStep): void {
  const next = replayStart(at)
  if (replaying === on && startAt === next) return
  replaying = on
  startAt = next
  for (const l of [...listeners]) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useOnboardingReplay(): boolean {
  return useSyncExternalStore(subscribe, () => replaying)
}

export const onboardingReplayStart = (): OnboardingStep => startAt
