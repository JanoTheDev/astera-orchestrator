// W11 plan page: "Wave n of m" and what opens the next wave. Pure, so the node-only test suite reaches it; the waves
// themselves are planBoard.ts's (wavesOf, currentWaveOf).
import type { JobTask } from '../../../../core/types'
import { categoryOf, currentWaveOf, type PlanWave } from './planBoard'

export type WaveStatus =
  | { kind: 'empty' }
  | { kind: 'done'; total: number }
  /** `n` is 1-based. `next` is the 1-based wave that opens after this one, null on the last wave. `waitingOn` is what
   *  still has to finish: the next wave's unfinished dependencies, or on the last wave the current wave's unfinished Tasks. */
  | { kind: 'running'; n: number; total: number; next: number | null; waitingOn: JobTask[] }

export function waveStatusOf(waves: readonly PlanWave[], deps: Readonly<Record<string, string[]>>): WaveStatus {
  if (waves.length === 0) return { kind: 'empty' }
  const current = currentWaveOf(waves)
  if (current === -1) return { kind: 'done', total: waves.length }
  const open = (tk: JobTask): boolean => categoryOf(tk) !== 'done'
  const unfinished = waves[current].tasks.filter(open)
  const nextWave = waves[current + 1]
  if (!nextWave) return { kind: 'running', n: current + 1, total: waves.length, next: null, waitingOn: unfinished }
  // The next wave opens Task by Task as each one's dependencies finish; the whole wave is open once all of them are.
  const byId = new Map(waves.flatMap((w) => w.tasks).map((tk) => [tk.id, tk]))
  const gate = new Map<string, JobTask>()
  for (const tk of nextWave.tasks)
    for (const id of deps[tk.id] ?? []) {
      const dep = byId.get(id)
      if (dep && open(dep)) gate.set(id, dep)
    }
  // No dependency data (a detail not caught up yet): the current wave's unfinished Tasks are the best answer.
  const waitingOn = gate.size > 0 ? [...gate.values()] : unfinished
  return { kind: 'running', n: current + 1, total: waves.length, next: current + 2, waitingOn }
}

/** Task titles for one line: the first `max`, then "+N" for the rest. */
export function titlesLine(tasks: readonly JobTask[], max = 3): string {
  const shown = tasks.slice(0, max).map((tk) => tk.title).join(', ')
  return tasks.length > max ? `${shown} +${tasks.length - max}` : shown
}
