import type { LucideIcon } from 'lucide-react'

export type IconSize = 14 | 16 | 20

/** A lucide icon (pass the imported component, so unused icons stay out of the bundle). Decorative unless `label` is given. */
export function Icon({ icon: Glyph, size = 16, label, className }: { icon: LucideIcon; size?: IconSize; label?: string; className?: string }): React.JSX.Element {
  return label ? (
    <Glyph size={size} className={className} role="img" aria-label={label} />
  ) : (
    <Glyph size={size} className={className} aria-hidden="true" />
  )
}
