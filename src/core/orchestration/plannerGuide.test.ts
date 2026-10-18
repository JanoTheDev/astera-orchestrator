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
