// Stopping a console (the wall's "End session", the view's Stop, the header's Stop): a running one asks first, an
// exited one just closes. The tab closes with 'end' (useWorkbench), which ends the process.
import type { Translate } from '../checkText'
import { confirmModal } from '../../lib/confirm'
import { consoleTitle, type WallConsole } from './wallModel'

export async function stopConsole(c: WallConsole, running: boolean, t: Translate, end: () => void): Promise<void> {
  if (running && !(await confirmModal({ title: t('wall.end.title', { name: consoleTitle(c) }), body: t('wall.end.body'), confirmLabel: t('wall.end.confirm') }))) return
  end()
}
