// Build warnings that say nothing about this code, so the ones that do are not lost among them.
//
// zod (a devDependency, so bundled into the main build) explains its `/*@__PURE__*/` annotations in a prose comment
// right above them ("Wrapped in a `@__PURE__` IIFE: …"). Rollup reads the words in that prose as an annotation in a
// place it cannot use, and drops the prose comment: INVALID_ANNOTATION, on every build. The real annotation below it is
// kept, so the bundle is the same with or without the warning.

/** The fields of a Rollup warning this filter reads. */
export interface BuildWarning {
  code?: string
  id?: string
  message: string
}

/** True for a warning the build drops: zod's INVALID_ANNOTATION, and nothing else. */
export function isNoise(w: BuildWarning): boolean {
  return w.code === 'INVALID_ANNOTATION' && w.id !== undefined && /[\\/]node_modules[\\/]zod[\\/]/.test(w.id)
}
