// W6-A: the planner guide's "Before you plan" step, which every intake starts the planner with.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const guide = readFileSync(path.join(__dirname, '../../../resources/skills/planner-guide.md'), 'utf8')

describe('planner-guide.md — before you plan', () => {
  it('checks the repo rules, the code, GitHub and other Jobs, writes existing.md and plans by state', () => {
    const section = guide.slice(guide.indexOf('## 0. Before you plan'), guide.indexOf('## 1.'))
    for (const needle of ['CONTRIBUTING.md', '.github/', 'gh issue list', 'gh pr list', 'jobs list --project', 'existing.md', '`missing`', '`partial`', '`broken`', '`built`', 'task-link-issue', '--basis', 'plan-nothing-to-do'])
      expect(section, needle).toContain(needle)
  })
})

describe('planner-guide.md — planning mode (T1)', () => {
  it('has the chat and auto guidance', () => {
    const section = guide.slice(guide.indexOf('## 7. Planning mode'))
    for (const needle of ['superpowers:brainstorming', 'one question at a time', 'under "Decisions"', 'gh issue list --state open', 'Never ask them to attach files'])
      expect(section, needle).toContain(needle)
  })
})

describe('planner-guide.md — multi-file planning and waves', () => {
  it('states the path rules for --affected-paths', () => {
    const section = guide.slice(guide.indexOf('**Path rules for `--affected-paths`'), guide.indexOf('**Prompts.**'))
    for (const needle of ['Repo-relative, forward slashes', 'No leading `/` and no `./`', 'A folder ends with `/`', '`*` appears only in the last segment', 'Never `.` or `/`', 'List exactly the files'])
      expect(section, needle).toContain(needle)
  })
  it('cuts by ownership, handles shared files and sizes the waves', () => {
    const section = guide.slice(guide.indexOf('## 2. Cut the objective'), guide.indexOf('## 3. Write each Task'))
    for (const needle of ['Cut by ownership, not by step', 'Shared files go to one Task', 'i18n catalogs', '`types.ts`', 'Size the waves', 'foundations', 'worker limit'])
      expect(section, needle).toContain(needle)
  })
  it('tells workers to use subagents for exploration', () => {
    expect(guide).toContain('Tell each worker to use subagents for read-only exploration')
  })
})

describe('planner-guide.md — objective coverage and the plan name (T7)', () => {
  it('section 3 asks for --covers, --left-out with a reason and jobs rename; section 4 checks them before handing over', () => {
    const write = guide.slice(guide.indexOf('## 3. Write each Task'), guide.indexOf('## 4.'))
    for (const needle of ['`--covers`', 'jobs-set --id <jobId> --left-out', '"reason"', 'jobs rename --id <jobId> --title'])
      expect(write, needle).toContain(needle)
    const hand = guide.slice(guide.indexOf('## 4. Hand over'), guide.indexOf('## 5.'))
    for (const needle of ['--covers', 'jobs-set --left-out', 'jobs rename']) expect(hand, needle).toContain(needle)
  })
})

describe('planner-guide.md — the main plan (T3)', () => {
  it('section 0 says to depend on another plan’s Task, section 3 how checks are set', () => {
    const before = guide.slice(guide.indexOf('## 0. Before you plan'), guide.indexOf('## 1.'))
    for (const needle of ['MAIN PLAN', 'astera main-plan', '`--deps <taskId>`', 'is not planned again', 'delivered', 'wait on each other'])
      expect(before, needle).toContain(needle)
    const write = guide.slice(guide.indexOf('## 3. Write each Task'), guide.indexOf('## 4.'))
    for (const needle of ['`--validate` is quick', 'delivery check', 'whole-plan check'])
      expect(write, needle).toContain(needle)
  })
})

describe('planner-guide.md — precise paths and per-Task waves', () => {
  it('asks for exact paths, merge and check Task paths', () => {
    const section = guide.slice(guide.indexOf('**Path rules for `--affected-paths`'), guide.indexOf('**Prompts.**'))
    for (const needle of ['exactly the files', 'git diff --name-only <base>...<branch>', 'never `src/` or `.`', 'every other worker'])
      expect(section, needle).toContain(needle)
  })
  it('describes per-Task opening, scoped and unscoped replans and leases', () => {
    const section = guide.slice(guide.indexOf('## 5. Replanning'), guide.indexOf('**Final check.**'))
    for (const needle of ['no whole-wave barrier', 'its own deps', '**scoped**', '**unscoped**', 'whole Job', 'really changed'])
      expect(section, needle).toContain(needle)
    expect(section).not.toContain('only when every Task of the waves before it')
  })
})
