/** The first message of the "Generate with AI" session in the run configuration manager: it sends an
 *  agent through the project and has it save fitting configurations with `astera run-configs add`
 *  (command.ts `run-configs-add`, held to the rules the manager's Apply uses). Node-free: the renderer
 *  builds it. */
export function buildGeneratePrompt(o: { projectPath: string; existingNames: string[] }): string {
  const existing = o.existingNames.length > 0 ? o.existingNames.map((n) => JSON.stringify(n)).join(', ') : 'none yet'
  return [
    `Set up run configurations for the project at ${o.projectPath}.`,
    '',
    'Read the project first: the package scripts (package.json and the like), the Makefile or other task runners, the CI workflows, and the test setup. Work out how to test it, build it and, if it has one, run it for development.',
    '',
    'Then propose the configurations you would add (name, type, command) and save each one with:',
    `  astera run-configs add --project ${JSON.stringify(o.projectPath)} --config -`,
    'The JSON object goes in on standard input, for example {"name":"Test","type":"shell","command":"npm test"}. A refusal names the reason: fix the configuration and save it again.',
    '',
    `Configurations that already exist: ${existing}. Do not save a second one under a name that is taken unless you mean to replace it.`,
    '',
    'Save configurations only through `astera run-configs add`. Do not edit, create or delete any file in the project.'
  ].join('\n')
}
