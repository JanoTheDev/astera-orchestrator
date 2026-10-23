// English · about area. Which files each area serves: ../README.md.
import type { about as ko } from '../ko/about'

export const about: Record<keyof typeof ko, string> = {
  'settings.group.about': 'About',
  'about.buildVersion': 'Build version',
  'about.copy': 'Copy',
  'about.copied': 'Copied',
  'about.copyVersion': 'Copy build version',
  'about.updateChannel': 'Update channel',
  'about.channel.stable': 'Stable',
  'about.channel.beta': 'Beta',
  'about.channel.hint': 'Stable gets finished releases only. Beta also gets test releases before they reach everyone.',
  'about.channel.saveFailed': 'Could not save the update channel: {detail}',
  'about.crashReports': 'Crash reports',
  'about.crash.ask': 'Ask',
  'about.crash.never': 'Never',
  'about.crash.hint': 'When Astera hits an error, it asks whether to send a report. You read the report before it goes anywhere. Never stops the question.',
  'about.crash.saveFailed': 'Could not save the crash report setting: {detail}',
  'about.license': 'License',
  'about.license.personal': 'Personal build',
  'about.licenses.title': 'Open source licenses',
  'about.licenses.hint': 'The software Astera is built from, and the terms it comes with.',
  'about.licenses.open': 'View',
  'about.licenses.search': 'Search licenses',
  'about.licenses.count': '{count} items',
  'about.licenses.empty': 'No license matches "{query}".',
  'about.licenses.loading': 'Loading…',
  'about.licenses.missingTitle': 'The license list is not generated yet',
  'about.licenses.missing': 'Run node scripts/gen-licenses.mjs in the Astera folder, then reopen this window. Installed apps include it from the start.',
  'about.licenses.noText': 'This package ships no license file. Its license field says {license}.',
  'about.licenses.pick': 'Pick an entry on the left to read its full text.'
}
