// The prompt of an AI code review (CodeRabbit-style) and the title of its chat session. Node-free: the renderer builds it.

export type ReviewTarget =
  | { kind: 'pr'; number: number; url?: string; title?: string; base?: string; head?: string }
  | { kind: 'branch'; base: string; head: string; title?: string }

export function codeReviewTitle(target: ReviewTarget): string {
  if (target.kind === 'pr') return `Review: PR #${target.number}${target.title ? ` ${target.title}` : ''}`
  return `Review: ${target.title || target.head}`
}

function subject(target: ReviewTarget): string[] {
  if (target.kind === 'branch') return [`Review the branch \`${target.head}\` against \`${target.base}\`${target.title ? ` ("${target.title}")` : ''}.`]
  const lines = [`Review pull request #${target.number}${target.title ? ` "${target.title}"` : ''}.`]
  if (target.url) lines.push(`URL: ${target.url}`)
  if (target.base && target.head) lines.push(`Merges \`${target.head}\` into \`${target.base}\`.`)
  return lines
}

function reading(target: ReviewTarget): string[] {
  if (target.kind === 'branch')
    return [
      `- \`git diff ${target.base}...${target.head}\` for the change, \`git log ${target.base}..${target.head}\` for the commits.`,
      `- \`git show ${target.head}:<path>\` for the whole file around a change.`
    ]
  const n = target.number
  return [
    `- \`gh pr view ${n} --json title,body,files,baseRefName,headRefName\` for the description and the files, \`gh pr diff ${n}\` for the change.`,
    `- For the whole file around a change: \`git fetch origin pull/${n}/head\`, then \`git show FETCH_HEAD:<path>\`. Never check out the branch or change the working tree.`
  ]
}

/** The first message of a review chat: what to read, the report to write, and the rules. */
export function codeReviewPrompt(target: ReviewTarget): string {
  const post =
    target.kind === 'pr'
      ? `Post nothing to GitHub unless the person asks for it in this chat, and then only with \`gh pr review ${target.number} --comment --body-file -\` (or \`--request-changes\`).`
      : 'Post nothing anywhere unless the person asks for it in this chat.'
  return [
    '# AI code review',
    '',
    ...subject(target),
    '',
    '## Read',
    ...reading(target),
    '',
    '## Report',
    '1. Summary: two or three sentences on what the change does.',
    '2. Walkthrough: a table, one row per changed file: file → what changed.',
    '3. Findings, grouped by severity in this order: critical, major, minor, nit. Each has `file:line`, the problem, why it matters, and a concrete suggested fix (a small diff when it helps).',
    '4. Verdict: approve or request changes, with one line of reason.',
    '',
    '## Rules',
    '- Read-only: change no file and commit nothing.',
    `- ${post}`,
    '- Check every finding against the code before you report it. Drop what you cannot confirm.',
    '- Skip style nits a linter or formatter would catch.'
  ].join('\n')
}
