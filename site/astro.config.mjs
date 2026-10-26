// The Astera docs site (README.md here). Pages come from ../docs through ../scripts/docs-site-sync.mjs, which also
// owns the sidebar, so a page is added in one place.
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'
import { REPO_URL, sidebar, siteBase } from '../scripts/docs-site-sync.mjs'

export default defineConfig({
  // DOCS_SITE: the full origin it is served from (canonical URLs, sitemap). DOCS_BASE: the path under it.
  site: process.env.DOCS_SITE || undefined,
  base: siteBase(),
  // The home page imports screenshots from the repo's assets/, one level above this project.
  vite: { server: { fs: { allow: ['..'] } } },
  integrations: [
    starlight({
      title: 'Astera',
      description: 'Hand it a plan. It runs the agents. It asks you only when it must.',
      logo: { src: '../assets/mark.svg', alt: 'Astera' },
      favicon: '/assets/mark.svg',
      social: [{ icon: 'github', label: 'GitHub', href: REPO_URL }],
      customCss: ['./src/styles/astera.css'],
      sidebar: sidebar(),
      // The home hero's Get started button is relative, since frontmatter cannot carry the base; from the home
      // page it resolves under any base.
      plugins: [starlightLinksValidator({ exclude: ['docs/getting-started/'] })]
    })
  ]
})
