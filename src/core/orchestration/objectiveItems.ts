// T7 objective coverage: the items an objective lists, so `validatePlan` (planner.ts) can tell a plan that drops one.
//
// An item is a top-level numbered line (`1.`, `1)`) or bullet (`-`, `*`, `•`). A line indented deeper than the
// top-level items, a nested list included, belongs to the item above it. Lines inside a ``` fence are not read.
// **Numbered items win**: an objective with any numbered item is read by its numbers, and its top-level bullets are
// notes, not items; one with bullets only numbers them 1, 2, 3 in order. Pure: the renderer may read it.

export interface ObjectiveItem {
  /** What `--covers` and `--left-out` name it by: its own number, or a bullet's place (1-based). */
  n: number
  /** Its first line, the marker dropped. */
  text: string
}

const NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/
const BULLET = /^(\s*)[-*•]\s+(.*)$/

/** The top-level items of `objective`, in order; [] when it lists none (its coverage is then not checked). */
export function objectiveItemsOf(objective: string): ObjectiveItem[] {
  const lines: string[] = []
  let fenced = false
  for (const line of objective.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced
    else if (!fenced) lines.push(line)
  }
  const numbered = lines.map((l) => NUMBERED.exec(l)).filter((m) => m !== null)
  if (numbered.length > 0) {
    const top = Math.min(...numbered.map((m) => m[1].length))
    const seen = new Set<number>()
    const out: ObjectiveItem[] = []
    for (const m of numbered) {
      const n = Number(m[2])
      if (m[1].length !== top || seen.has(n)) continue
      seen.add(n)
      out.push({ n, text: m[3].trim() })
    }
    return out
  }
  const bullets = lines.map((l) => BULLET.exec(l)).filter((m) => m !== null)
  if (bullets.length === 0) return []
  const top = Math.min(...bullets.map((m) => m[1].length))
  return bullets.filter((m) => m[1].length === top).map((m, i) => ({ n: i + 1, text: m[2].trim() }))
}
