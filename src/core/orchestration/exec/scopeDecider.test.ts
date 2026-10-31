import { describe, expect, it } from 'vitest'
import { isScopeQuestion, pathsIn, SCOPE_ANSWER, scopeAnswerOf, type ScopeContext } from './scopeDecider'

// The owner-only words autoAnswer.ts passes in, reduced to what these cases need
const guarded = (text: string): boolean =>
  /\b(delet|remov|drop|wip(e|ing))\w*|force[- ]?push|\b(push|merg)\w*\b[^\n]{0,60}\b(main|master)\b|\b(password|token|api[- ]?key|credential)s?\b|\$\s?\d/i.test(text)
const win: ScopeContext = {
  roots: ['C:\\dev\\Astera', 'C:\\Users\\me\\astera-worktrees\\Astera\\T11'],
  affectedPaths: ['src/core/orchestration/exec/autoAnswer.ts', 'src/core/orchestration/exec/'],
  guarded
}
const posix: ScopeContext = { roots: ['/home/me/repo'], affectedPaths: ['src/a/**'], guarded }

describe('scope questions', () => {
  it('a question about touching files outside the Task paths is one, with or without a path', () => {
    expect(isScopeQuestion('May I touch src/core/x.ts outside my paths?', win)).toBe(true)
    expect(isScopeQuestion('may I touch files outside my paths?', win)).toBe(true)
    expect(isScopeQuestion('Is it allowed to edit files not in my affected paths?', win)).toBe(true)
    expect(isScopeQuestion('I need permission to edit src/core/state.ts', win)).toBe(true)
  })

  it('a small refactor of a shared helper, a new test file, a catalog entry', () => {
    expect(isScopeQuestion('Can I do a small refactor of the shared helper in src/core/util/text.ts?', win)).toBe(true)
    expect(isScopeQuestion('May I add a test file src/core/orchestration/view.test.ts?', win)).toBe(true)
    expect(isScopeQuestion('Should I update the catalog entry in src/core/i18n/messages/en/jobs.ts?', win)).toBe(true)
  })

  it('Windows paths: inside the repository or the worktree, with backslashes and drive letters, in any case', () => {
    expect(isScopeQuestion('May I edit C:\\dev\\Astera\\src\\core\\x.ts outside my paths?', win)).toBe(true)
    expect(isScopeQuestion('May I edit c:/users/ME/astera-worktrees/astera/t11/src/y.ts outside my scope?', win)).toBe(true)
    expect(isScopeQuestion('May I edit src\\core\\orchestration\\types.ts too?', win)).toBe(true)
  })

  it('a path outside the repository and the worktrees is never one', () => {
    expect(isScopeQuestion('May I edit C:\\Windows\\System32\\drivers\\etc\\hosts outside my paths?', win)).toBe(false)
    expect(isScopeQuestion('May I edit D:\\other\\repo\\x.ts outside my paths?', win)).toBe(false)
    expect(isScopeQuestion('May I edit ../other-repo/x.ts outside my paths?', win)).toBe(false)
    expect(isScopeQuestion('May I change ~/.gitconfig outside my scope?', posix)).toBe(false)
    expect(isScopeQuestion('May I edit /etc/hosts outside my paths?', posix)).toBe(false)
    expect(isScopeQuestion('May I edit /home/me/repo/src/b/x.ts outside my paths?', posix)).toBe(true)
  })

  it('a path within the Task paths alone is no scope question', () => {
    expect(isScopeQuestion('May I edit src/core/orchestration/exec/autoAnswer.ts?', win)).toBe(false)
    expect(isScopeQuestion('Can I change src/a/b/c.ts?', posix)).toBe(false)
    expect(isScopeQuestion('Can I change src/b/c.ts?', posix)).toBe(true)
  })

  it('owner-only words and raised privileges are never one', () => {
    expect(isScopeQuestion('May I delete C:\\Users\\me\\data?', win)).toBe(false)
    expect(isScopeQuestion('May I delete the helper files outside my paths?', win)).toBe(false)
    expect(isScopeQuestion('Can I push to main after editing files outside my paths?', win)).toBe(false)
    expect(isScopeQuestion('May I force-push the edited files outside my paths?', win)).toBe(false)
    expect(isScopeQuestion('May I add the api key to the config file outside my paths?', win)).toBe(false)
    expect(isScopeQuestion('May I sudo chmod the files outside my paths?', posix)).toBe(false)
    expect(isScopeQuestion('May I edit src/x.ts and push to origin/main?', win)).toBe(false)
  })

  it('a file name is judged as a path, not as owner-only words', () => {
    expect(isScopeQuestion('May I add a test file src\\core\\login.test.ts?', win)).toBe(true)
    expect(isScopeQuestion('May I edit `src/core/tokens.ts` outside my paths?', win)).toBe(true)
    expect(isScopeQuestion('May I delete `src/core/tokens.ts` outside my paths?', win)).toBe(false)
  })

  it('a question that is not about changing files is not one', () => {
    expect(isScopeQuestion('Which colour should the button be?', win)).toBe(false)
    expect(isScopeQuestion('Should I add a retry to the fetch?', win)).toBe(false)
    expect(isScopeQuestion('Is the plan allowed to run tonight?', win)).toBe(false)
  })

  it('the answer is the instruction, or an option that says yes followed by it', () => {
    expect(scopeAnswerOf({ question: 'may I touch files outside my paths?' }, win)).toBe(SCOPE_ANSWER)
    expect(scopeAnswerOf({ question: 'may I touch files outside my paths?', options: ['no', 'yes'] }, win)).toMatch(/^yes: hands-off plans settle scope/)
    expect(scopeAnswerOf({ question: 'Which colour?' }, win)).toBeNull()
  })

  it('pathsIn reads paths and file names, not words with a slash', () => {
    expect(pathsIn('Edit `src/x.ts`, C:\\a\\b.ts and view.test.ts? yes/no, e.g. this')).toEqual(['src/x.ts', 'C:\\a\\b.ts', 'view.test.ts'])
  })
})
