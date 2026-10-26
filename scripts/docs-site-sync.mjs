#!/usr/bin/env node
// Turns docs/*.md into the docs site's pages (site/README.md). docs/ stays the single source and keeps reading well on
// GitHub, so the pages there carry no frontmatter: this script adds it, drops the H1 Starlight renders from the title,
// and points relative links and images at the site's routes and files. Its output is generated and gitignored:
//   site/src/content/docs/docs/  the pages (the hand-written home page, site/src/content/docs/index.mdx, is outside it)
//   site/public/assets/          the repo's assets/ files the pages use, plus the mark for the favicon
// site/astro.config.mjs imports SIDEBAR and siteBase from here, so the page list lives in one place.
//
// Usage: node scripts/docs-site-sync.mjs   (DOCS_BASE, as for the build: the links it writes carry the base)
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REPO_URL = 'https://github.com/JanoTheDev/astera-orchestrator'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Starlight content folder for the generated pages; also the first segment of every generated route. */
const GEN_DIR = 'docs'
const IMAGE = /\.(png|jpe?g|gif|svg|webp|avif)$/i

/** The sidebar, group by group: [docs/ path, sidebar label, badge?]. Every page here is generated; docs/README.md is
 *  the hub the home page replaces, and docs/dev/, docs/perf/ and docs/shots/ stay out. */
export const GROUPS = [
  { label: 'Start here', pages: [['getting-started.md', 'Getting started'], ['concepts.md', 'Concepts']] },
  {
    label: 'Use Astera',
    pages: [
      ['guide.md', 'User guide'],
      ['usage-guide.md', 'Usage guide'],
      ['jobs.md', 'Jobs'],
      ['how-it-works.md', 'How it works'],
      ['troubleshooting.md', 'Troubleshooting']
    ]
  },
  {
    label: 'Understand it',
    pages: [
      ['architecture.md', 'Architecture'],
      ['agent-workspace-isolation.md', 'Agent workspace isolation', 'Design brief'],
      ['product/README.md', 'Product docs'],
      ['product/features.md', 'Features'],
      ['product/known-limits.md', 'Known limits'],
      ['product/licensing.md', 'Licensing']
    ]
  },
  {
    label: 'Build on Astera',
    pages: [
      ['cli.md', 'CLI'],
      ['mcp.md', 'MCP'],
      ['sdk.md', 'SDK'],
      ['plugins.md', 'Plugins'],
      ['remote-runtime.md', 'Remote runtime']
    ]
  },
  { label: 'Integrations', pages: [['slack-bot-setup.md', 'Slack bot setup'], ['telegram-bot-setup.md', 'Telegram bot setup']] },
  { label: 'Project', pages: [['releasing.md', 'Releasing']] }
]

/** DOCS_BASE as Astro wants it and as the links need it: '/' or '/a/b/'. */
export function siteBase(env = process.env) {
  const parts = (env.DOCS_BASE ?? '').split('/').filter(Boolean)
  return parts.length ? `/${parts.join('/')}/` : '/'
}

/** docs/ path → route without base: guide.md → docs/guide/, product/README.md → docs/product/,
 *  release-notes/v1.4.14.md → docs/release-notes/v1-4-14/ (dots would be dropped by the slugger, v1.4.1 vs v14.1). */
export function routeOf(src) {
  const path = src.replace(/(^|\/)README\.md$/, '').replace(/\.md$/, '').replace(/\./g, '-')
  return `${GEN_DIR}/${path}${path ? '/' : ''}`.toLowerCase()
}

/** Newest first, by number: v1.4.10 above v1.4.9. */
export function semverDesc(a, b) {
  const nums = (v) => v.replace(/^.*?v?(\d+(?:\.\d+)*).*$/, '$1').split('.').map(Number)
  const [x, y] = [nums(a), nums(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
  return 0
}

export function releaseNotes(root = ROOT) {
  return readdirSync(join(root, 'docs/release-notes'))
    .filter((f) => /^v\d.*\.md$/.test(f))
    .sort(semverDesc)
    .map((f) => [`release-notes/${f}`, f.replace(/\.md$/, '')])
}

/** Starlight's sidebar config: groups of slugs, release notes collapsed under Project. */
export function sidebar(root = ROOT) {
  const item = ([src, label, badge]) => ({ label, slug: routeOf(src).replace(/\/$/, ''), ...(badge ? { badge } : {}) })
  return GROUPS.map((g) => ({
    label: g.label,
    items: [
      ...g.pages.map(item),
      ...(g.label === 'Project' ? [{ label: 'Release notes', collapsed: true, items: releaseNotes(root).map(item) }] : [])
    ]
  }))
}

/** Splits Markdown into [text, isCode] chunks by fenced code blocks, so rewrites never touch code. */
function fencedChunks(md) {
  const chunks = []
  let fence = null
  let buf = []
  const flush = (code) => {
    if (buf.length) chunks.push([buf.join('\n'), code])
    buf = []
  }
  for (const line of md.split('\n')) {
    const m = line.match(/^\s*(`{3,}|~{3,})/)
    if (!fence && m) {
      flush(false)
      fence = m[1]
      buf.push(line)
    } else if (fence && m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) {
      buf.push(line)
      flush(true)
      fence = null
    } else buf.push(line)
  }
  flush(fence !== null)
  return chunks
}

/** The first H1 outside code, and the Markdown without it. */
export function splitTitle(md) {
  let offset = 0
  for (const [text, code] of fencedChunks(md)) {
    const m = code ? null : text.match(/^# +(.+?)\s*#*\s*$/m)
    if (m) {
      const start = offset + m.index
      const body = (md.slice(0, start) + md.slice(start + m[0].length)).replace(/^\s*\n/, '')
      return { title: plain(m[1]), body }
    }
    offset += text.length + 1
  }
  return { title: null, body: md }
}

/** Markdown inline → plain text, for frontmatter. */
function plain(s) {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The first prose paragraph: not a heading, list, table, quote, HTML, image or code. */
export function descriptionOf(body) {
  for (const [text, code] of fencedChunks(body)) {
    if (code) continue
    for (const para of text.split(/\n\s*\n/)) {
      const first = para.trim()
      if (!first || /^(#|[-*+] |\d+[.)] |\||>|<|!\[)/.test(first)) continue
      return plain(para)
    }
  }
  return null
}

/** One link or image target, written relative to docs/<src>, as the site serves it.
 *  Returns { url, asset } where asset is the repo path of an image to copy, if any. */
export function rewriteTarget(target, src, { base = '/', pages }) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return { url: target }
  const [path, hash = ''] = target.split(/(?=#)/)
  const repoPath = posix.normalize(posix.join('docs', posix.dirname(src), path))
  if (repoPath.startsWith('..')) return { url: target }
  const docsPath = repoPath.replace(/^docs\//, '')
  if (repoPath === 'docs/README.md') return { url: `${base}${hash}` }
  if (repoPath.startsWith('docs/') && pages.has(docsPath)) return { url: `${base}${routeOf(docsPath)}${hash}` }
  if (IMAGE.test(repoPath)) {
    if (!repoPath.startsWith('assets/')) throw new Error(`docs/${src}: image ${target} is outside assets/, so the site cannot serve it`)
    return { url: `${base}${repoPath}`, asset: repoPath }
  }
  // Anything else in the repo (docs/dev/, examples/, src/, .github/): its page on GitHub.
  const kind = /\.[a-z0-9]+$/i.test(repoPath) ? 'blob' : 'tree'
  return { url: `${REPO_URL}/${kind}/main/${repoPath.replace(/\/$/, '')}${hash}` }
}

/** Rewrites Markdown links and images and raw HTML src/href outside code. Inline code spans stay as they are. */
export function rewriteLinks(md, src, opts) {
  const assets = new Set()
  const fix = (target) => {
    const r = rewriteTarget(target, src, opts)
    if (r.asset) assets.add(r.asset)
    return r.url
  }
  const TOKEN = /(`+)[\s\S]*?\1|(\]\()(<[^>]*>|[^)\s]+)((?:\s+"[^"]*")?\))|(\s(?:src|href)=")([^"]+)(")/g
  const out = fencedChunks(md)
    .map(([text, code]) =>
      code
        ? text
        : text.replace(TOKEN, (all, tick, open, target, close, attr, value, quote) => {
            if (tick) return all
            if (open) {
              const bare = target.replace(/^<|>$/g, '')
              return `${open}${fix(bare)}${close}`
            }
            return `${attr}${fix(value)}${quote}`
          })
    )
    .join('\n')
  return { md: out, assets }
}

/** One docs/ page as a Starlight page: frontmatter, body without its H1, rewritten links. */
export function toPage(md, src, opts) {
  const { title, body } = splitTitle(md)
  const name = posix.basename(src, '.md')
  const isRelease = src.startsWith('release-notes/')
  const description = descriptionOf(body) ?? (isRelease ? `What changed in Astera ${name}.` : null)
  const { md: content, assets } = rewriteLinks(body, src, opts)
  const front = [`title: ${JSON.stringify(title ?? name)}`, ...(description ? [`description: ${JSON.stringify(description)}`] : [])]
  return { text: `---\n${front.join('\n')}\n---\n\n${content}`, assets }
}

export function sync({ root = ROOT, base = siteBase() } = {}) {
  const srcs = [...GROUPS.flatMap((g) => g.pages.map(([s]) => s)), ...releaseNotes(root).map(([s]) => s)]
  const pages = new Set(srcs)
  const outDir = join(root, 'site/src/content/docs', GEN_DIR)
  const assetDir = join(root, 'site/public/assets')
  rmSync(outDir, { recursive: true, force: true })
  rmSync(assetDir, { recursive: true, force: true })
  const assets = new Set(['assets/mark.svg'])
  for (const src of srcs) {
    const page = toPage(readFileSync(join(root, 'docs', src), 'utf8'), src, { base, pages })
    const out = join(root, 'site/src/content/docs', `${routeOf(src).replace(/\/$/, '')}${src.endsWith('README.md') ? '/index' : ''}.md`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, page.text)
    page.assets.forEach((a) => assets.add(a))
  }
  for (const a of assets) {
    mkdirSync(dirname(join(root, 'site/public', a)), { recursive: true })
    copyFileSync(join(root, a), join(root, 'site/public', a))
  }
  return { pages: srcs.length, assets: assets.size, base }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = sync()
  console.log(`docs-site-sync: ${r.pages} pages, ${r.assets} assets, base ${r.base}`)
}
