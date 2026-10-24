/** Remembers the last call: the same argument objects (===) return the same result object, a changed one recomputes.
 *  The snapshot object is the state version, so a push that changed nothing keeps every derived value. */
export function memoByIdentity<A extends readonly unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: { args: A; result: R } | undefined
  return (...args) => {
    if (last && last.args.length === args.length && last.args.every((a, i) => a === args[i])) return last.result
    last = { args, result: fn(...args) }
    return last.result
  }
}
