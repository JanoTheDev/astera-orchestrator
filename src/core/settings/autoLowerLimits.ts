// Whether Astera may lower the agent limits on its own (load monitor, crash, out-of-memory, window freezes), and how far.
// app-settings.json key `autoLowerLimits`. Node-free, like minWorkersUnderPressure.ts: Settings shows the same choice.
import { minWorkersFloor, minWorkersUnderPressureOf } from './minWorkersUnderPressure'

/** `on`: Astera lowers on its own (the load monitor still stops at the owner's minimum). `floor`: no automatic lowering
 *  takes the agent cap below the owner's minimum, nor heavy slots below 1. `off`: nothing lowers a limit by itself. */
export type AutoLowerMode = 'on' | 'floor' | 'off'

export const AUTO_LOWER_MODES: readonly AutoLowerMode[] = ['on', 'floor', 'off']
export const AUTO_LOWER_DEFAULT: AutoLowerMode = 'floor'

/** Anything the user-editable file holds that is not one of the three reads as the default. */
export function autoLowerLimitsOf(value: unknown): AutoLowerMode {
  return AUTO_LOWER_MODES.find((m) => m === value) ?? AUTO_LOWER_DEFAULT
}

export interface LowerPolicy {
  mode: AutoLowerMode
  /** The owner's minimum agents under pressure (minWorkersFloor). */
  floor: number
}

/** The policy from the settings file's object and the owner's own agent limit; no file reads as the defaults. */
export function lowerPolicyOf(settings: { autoLowerLimits?: unknown; minWorkersUnderPressure?: unknown } | null | undefined, personWorkers: number): LowerPolicy {
  return {
    mode: autoLowerLimitsOf(settings?.autoLowerLimits),
    floor: minWorkersFloor(personWorkers, minWorkersUnderPressureOf(settings?.minWorkersUnderPressure))
  }
}

/** The cap an automatic lowering may set: `proposed` under `on`, `proposed` held at `floor` under `floor` (a cap already
 *  below the floor stays as it is, never raised), and `current` (no change) under `off`. Pass floor 1 for heavy slots. */
export function clampLowering(mode: AutoLowerMode, floor: number, proposed: number, current: number): number {
  if (mode === 'off') return current
  if (mode === 'floor') return Math.min(current, Math.max(floor, proposed))
  return proposed
}
