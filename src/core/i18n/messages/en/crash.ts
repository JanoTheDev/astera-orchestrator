// English · crash area. Which files each area serves: ../README.md.
import type { crash as ko } from '../ko/crash'

export const crash: Record<keyof typeof ko, string> = {
  'crash.prompt.title': 'Send an error report?',
  'crash.prompt.intro':
    'Astera ran into an error. Below is the report exactly as it would be sent. Send opens a new GitHub issue in your browser with this text, where you can still edit or cancel it. Nothing leaves this computer otherwise.',
  'crash.prompt.kept': 'Reports stay only on this computer, for 30 days at most.',
  'crash.prompt.send': 'Send',
  'crash.prompt.dontSend': 'Do not send',
  'crash.prompt.never': 'Never ask',
  'crash.prompt.reportLabel': 'The report to send'
}
