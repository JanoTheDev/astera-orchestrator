// W9-H, W11, W13: how a console's state is worded and drawn: the Agents view's rows and the console header's chip.
import type { MessageKey } from '../../../../core/i18n'
import { useI18n } from '../../i18n/I18nProvider'
import { Chip, Icon, type ChipTone, type IconName } from '../ui'
import type { WallConsole } from './wallModel'

/** The state's word ("Permission", "Working", "Finished") and its icon: the second cue beside the colour (DESIGN-W11 §2). */
export const stateWord = (c: WallConsole): MessageKey =>
  c.state === 'needs'
    ? c.needs === 'permission' ? 'wall.state.permission' : c.needs === 'gate' ? 'wall.state.gate' : 'wall.state.question'
    : c.state === 'working' ? 'wall.state.working' : c.state === 'finished' ? 'wall.state.finished' : 'wall.state.idle'
export const stateGlyph = (c: WallConsole): IconName =>
  c.state === 'needs' ? (c.needs === 'permission' ? 'lock' : 'warning') : c.state === 'working' ? 'activity' : c.state === 'finished' ? 'done' : 'pending'
export const stateTone = (c: WallConsole): ChipTone =>
  c.state === 'needs' ? (c.tone ?? 'warn') : c.state === 'working' ? 'info' : c.state === 'finished' ? 'ok' : 'neutral'

export function StateChip({ c }: { c: WallConsole }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Chip tone={stateTone(c)}>
      <Icon name={stateGlyph(c)} size={14} />
      {t(stateWord(c))}
    </Chip>
  )
}
