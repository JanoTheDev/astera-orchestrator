// The docs site's page generator: titles, descriptions, link and image rewrites, anchors and the README hub.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  REPO_URL,
  descriptionOf,
  rewriteLinks,
  rewriteTarget,
  routeOf,
  semverDesc,
  sidebar,
  siteBase,
  splitTitle,
  sync,
  toPage
} from './docs-site-sync.mjs'

const pages = new Set(['guide.md', 'getting-started.md', 'product/features.md', 'product/README.md', 'release-notes/v1.4.14.md'])
const opts = { base: '/', pages }

describe('docs-site-sync', () => {
  it('takes the title from the first H1 outside code and drops that H1', () => {
    const md = '```bash\n# a shell comment\n```\n\n# The `astera` command\n\nIntro.\n\n# second\n'
    const { title, body } = splitTitle(md)
    expect(title).toBe('The astera command')
    expect(body).toContain('# a shell comment')
    expect(body).not.toContain('# The')
    expect(body).toContain('# second')
  })

  it('describes a page by its first prose paragraph, as plain text', () => {
    const body = '<img src="x.png" />\n\n## Heading\n\n- a list\n\nThe [user guide](guide.md) has **the depth**\nand `more`.\n\nNext.'
    expect(descriptionOf(body)).toBe('The user guide has the depth and more.')
    expect(descriptionOf('## Only\n\n- lists')).toBeNull()
  })

  it('maps docs/ paths to routes, README to its folder and release-note dots to dashes', () => {
    expect(routeOf('guide.md')).toBe('docs/guide/')
    expect(routeOf('product/README.md')).toBe('docs/product/')
    expect(routeOf('release-notes/v1.4.14.md')).toBe('docs/release-notes/v1-4-14/')
  })

  it('rewrites .md links to site routes and keeps the anchor', () => {
    expect(rewriteTarget('guide.md#needs-you', 'concepts.md', opts).url).toBe('/docs/guide/#needs-you')
    expect(rewriteTarget('../guide.md', 'product/features.md', opts).url).toBe('/docs/guide/')
    expect(rewriteTarget('features.md#x', 'product/README.md', opts).url).toBe('/docs/product/features/#x')
    expect(rewriteTarget('#local', 'guide.md', opts).url).toBe('#local')
    expect(rewriteTarget('https://example.com/a.md', 'guide.md', opts).url).toBe('https://example.com/a.md')
  })

  it('puts the base in front of every site link', () => {
    const base = siteBase({ DOCS_BASE: 'astera-orchestrator' })
    expect(base).toBe('/astera-orchestrator/')
    expect(siteBase({})).toBe('/')
    expect(rewriteTarget('getting-started.md#2-first-run', 'guide.md', { base, pages }).url).toBe(
      '/astera-orchestrator/docs/getting-started/#2-first-run'
    )
  })

  it('maps the docs hub to the home page and the project README and other repo files to GitHub', () => {
    expect(rewriteTarget('README.md', 'guide.md', opts).url).toBe('/')
    expect(rewriteTarget('../README.md', 'product/licensing.md', { base: '/b/', pages }).url).toBe('/b/')
    expect(rewriteTarget('../README.md#run-it', 'guide.md', opts).url).toBe(`${REPO_URL}/blob/main/README.md#run-it`)
    expect(rewriteTarget('dev/LINUX.md', 'guide.md', opts).url).toBe(`${REPO_URL}/blob/main/docs/dev/LINUX.md`)
    expect(rewriteTarget('../examples/plugins/linear-source', 'plugins.md', opts).url).toBe(
      `${REPO_URL}/tree/main/examples/plugins/linear-source`
    )
    expect(rewriteTarget('../dev/', 'product/README.md', opts).url).toBe(`${REPO_URL}/tree/main/docs/dev`)
  })

  it('rewrites Markdown images and raw <img>/<a> tags, but not code', () => {
    const md = [
      '![A](../../assets/docs/a.png) and [guide](../guide.md#x "t")',
      '<a href="../guide.md#needs-you"><img src="../../assets/docs/b.png" width="760" alt="B" /></a>',
      'Inline `[x](guide.md)` stays.',
      '```md',
      '[y](guide.md)',
      '```'
    ].join('\n')
    const { md: out, assets } = rewriteLinks(md, 'product/features.md', { base: '/b/', pages })
    expect(out).toContain('![A](/b/assets/docs/a.png)')
    expect(out).toContain('[guide](/b/docs/guide/#x "t")')
    expect(out).toContain('<a href="/b/docs/guide/#needs-you"><img src="/b/assets/docs/b.png" width="760"')
    expect(out).toContain('`[x](guide.md)`')
    expect(out).toContain('```md\n[y](guide.md)\n```')
    expect([...assets]).toEqual(['assets/docs/a.png', 'assets/docs/b.png'])
  })

  it('refuses an image the site cannot serve', () => {
    expect(() => rewriteTarget('shots/a.png', 'guide.md', opts)).toThrow(/outside assets/)
  })

  it('writes frontmatter, with a fallback title and description for release notes', () => {
    const page = toPage('# Getting "started"\n\nFrom a fresh checkout.\n\n## Next\n', 'getting-started.md', opts)
    expect(page.text).toBe('---\ntitle: "Getting \\"started\\""\ndescription: "From a fresh checkout."\n---\n\nFrom a fresh checkout.\n\n## Next\n')
    const notes = toPage('## New features\n\n* one\n', 'release-notes/v1.4.14.md', opts)
    expect(notes.text).toMatch(/^---\ntitle: "v1.4.14"\ndescription: "What changed in Astera v1.4.14."\n---/)
  })

  it('sorts release notes by version, newest first', () => {
    expect(['v1.4.9', 'v1.3.25', 'v1.4.10', 'v1.4.0'].sort(semverDesc)).toEqual(['v1.4.10', 'v1.4.9', 'v1.4.0', 'v1.3.25'])
  })

  it('syncs a repo: pages, the hub left to the home page, assets copied, release notes in the sidebar', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'docs-site-sync-'))
    const real = path.resolve(import.meta.dirname, '..')
    mkdirSync(path.join(root, 'docs/release-notes'), { recursive: true })
    mkdirSync(path.join(root, 'docs/product'), { recursive: true })
    mkdirSync(path.join(root, 'assets/docs'), { recursive: true })
    for (const f of ['assets/mark.svg', 'assets/docs/plan-board.png']) writeFileSync(path.join(root, f), 'x')
    // Every sidebar page must exist; give them stubs, then a real one with a link and an image.
    for (const g of sidebar(real)) for (const i of g.items) if (i.slug) writeFileSync(path.join(root, 'docs', stubPath(i.slug)), `# ${i.label}\n`)
    writeFileSync(path.join(root, 'docs/guide.md'), '# Guide\n\nSee [the hub](README.md).\n\n<img src="../assets/docs/plan-board.png" />\n')
    for (const v of ['v1.4.9', 'v1.4.10']) writeFileSync(path.join(root, `docs/release-notes/${v}.md`), '## Fixes\n')
    writeFileSync(path.join(root, 'docs/README.md'), '# Hub\n')

    sync({ root, base: '/' })
    const gen = path.join(root, 'site/src/content/docs/docs')
    expect(readFileSync(path.join(gen, 'guide.md'), 'utf8')).toContain('See [the hub](/).')
    expect(existsSync(path.join(gen, 'product/index.md'))).toBe(true)
    expect(existsSync(path.join(gen, 'release-notes/v1-4-10.md'))).toBe(true)
    expect(existsSync(path.join(root, 'site/src/content/docs/docs/README.md'))).toBe(false)
    expect(existsSync(path.join(root, 'site/public/assets/docs/plan-board.png'))).toBe(true)
    expect(existsSync(path.join(root, 'site/public/assets/mark.svg'))).toBe(true)
    const notes = sidebar(root).at(-1).items.at(-1)
    expect(notes.items.map((i) => i.label)).toEqual(['v1.4.10', 'v1.4.9'])
  })
})

/** docs/<slug without the docs/ prefix>.md, or …/README.md for a folder route. */
function stubPath(slug) {
  const rel = slug.replace(/^docs\//, '')
  return rel === 'product' ? 'product/README.md' : `${rel}.md`
}
