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

describe('planner-guide.md — multi-file planning and waves', () => {
  it('states the path rules for --affected-paths', () => {
    const section = guide.slice(guide.indexOf('**Path rules for `--affected-paths`'), guide.indexOf('**Prompts.**'))
    for (const needle of ['Repo-relative, forward slashes', 'No leading `/` and no `./`', 'A folder ends with `/`', '`*` appears only in the last segment', 'Never `.` or `/`', 'List every file or folder'])
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
