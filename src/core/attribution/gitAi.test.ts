import { describe, it, expect } from 'vitest'
import { gitAiInstalled, gitAiLinesOf, parseGitAiNote } from './gitAi'

// The note git-ai v1.7.5 wrote in the W8-B spike (docs/dev/LINUX.md) for a Claude `Write`, with one human
// attestation (`h_…`, a session not in `sessions`) added to show it is not counted.
const FIXTURE = `f.txt
  s_f8fd3067c13536::t_712d2f52c3245e 1-5
  h_0000000000aaaa 6-8
src/b.ts
  s_f8fd3067c13536::t_ea44b33ab15440 2-3,9
---
{
  "schema_version": "authorship/3.0.0",
  "git_ai_version": "1.7.5",
  "base_commit_sha": "02275431221800a62c35fd3d295257e8392400bc",
  "prompts": {},
  "sessions": {
    "s_f8fd3067c13536": {
      "agent_id": { "tool": "claude", "id": "sess-1", "model": "claude-opus-5-5" },
      "human_author": "t <t@t>"
    }
  }
}`

describe('parseGitAiNote', () => {
  it('reads a git-ai authorship log into the Wave 8 lines shape', () => {
    expect(parseGitAiNote(FIXTURE)).toEqual({
      lines: { 'f.txt': [[1, 5]], 'src/b.ts': [[2, 3], [9, 9]] },
      toolModel: { 'claude::claude-opus-5-5': 8 }
    })
  })
  it('null for text that is not a log', () => {
    expect(parseGitAiNote('just a note')).toBeNull()
    expect(parseGitAiNote('a\n---\nnot json')).toBeNull()
  })
})

describe('gitAiLinesOf', () => {
  it('absent tool: null, no error, git never asked', async () => {
    let asked = false
    const r = await gitAiLinesOf('/repo', 'HEAD', {
      installed: async () => false,
      run: async () => ((asked = true), { ok: true, stdout: FIXTURE, stderr: '' })
    })
    expect(r).toBeNull()
    expect(asked).toBe(false)
  })
  it('installed: reads refs/notes/ai; no note is null', async () => {
    const seen: string[][] = []
    const r = await gitAiLinesOf('/repo', 'abc', {
      installed: async () => true,
      run: async (args) => (seen.push(args), { ok: true, stdout: FIXTURE, stderr: '' })
    })
    expect(seen[0]).toEqual(['notes', '--ref=refs/notes/ai', 'show', 'abc'])
    expect(r?.lines['f.txt']).toEqual([[1, 5]])
    expect(await gitAiLinesOf('/repo', 'abc', { installed: async () => true, run: async () => ({ ok: false, stdout: '', stderr: 'no note' }) })).toBeNull()
  })
  it('detection of a missing binary resolves false', async () => {
    const fake = ((_f: string, _a: string[], _o: unknown, cb: (e: Error | null) => void) => cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))) as never
    expect(await gitAiInstalled(fake)).toBe(false)
  })
})
