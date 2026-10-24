// A plan's short name, made from its objective when nobody named it: never the whole prompt.
const TITLE_MAX = 60
const ISSUE = /^Resolve GitHub issue #(\d+) in \S+?:\s+(.+)$/
const TRAILING = /[\s.,;:!?\-–—]+$/

/** The first sentence or clause of `objective`'s first line, at most TITLE_MAX characters, cut at a word boundary,
 *  no trailing punctuation. "Resolve GitHub issue #N in owner/repo: Title" becomes "#N Title". */
export function shortTitleOf(objective: string): string {
  let line = (objective.split(/\r?\n/).find((l) => l.trim() !== '') ?? '').replace(/^\s*#+\s*/, '').replace(/\s+/g, ' ').trim()
  const issue = ISSUE.exec(line)
  if (issue) line = `#${issue[1]} ${issue[2]}`
  line = line.replace(/[.!?](?=\s).*$/, '')
  if (line.length > TITLE_MAX) {
    const cut = line.slice(0, TITLE_MAX + 1)
    const at = cut.lastIndexOf(' ')
    line = at > 0 ? cut.slice(0, at) : cut.slice(0, TITLE_MAX)
  }
  return line.replace(TRAILING, '')
}
