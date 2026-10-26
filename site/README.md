# Astera docs site

The public documentation website, built with [Starlight](https://starlight.astro.build) (Astro). It has its own
`package.json` and lock file, kept apart from the app's dependencies.

`docs/*.md` stays the single source and keeps reading well on GitHub. `scripts/docs-site-sync.mjs` turns those pages
into site pages on every dev or build run:

- the title comes from the page's first H1, which is dropped (Starlight renders the title);
- the description comes from the first prose paragraph;
- relative links to `*.md` pages become site routes, `#anchors` kept. `docs/README.md` (the hub) becomes the home page.
  Links to anything else in the repository (`docs/dev/`, `examples/`, `src/`, `.github/`) go to its page on GitHub;
- image paths (`../assets/…`, in Markdown and in raw `<img>` tags) point at copies under `public/assets/`.

The output, `src/content/docs/docs/` and `public/assets/`, is generated and gitignored. The home page,
`src/content/docs/index.mdx`, is written by hand. The sidebar is `GROUPS` in the sync script: add a new page there.
Release notes (`docs/release-notes/`) are added on their own, newest version first.

## Run it

From the repository root:

```bash
npm ci --prefix site            # once
npm run docs:dev                # sync, then a dev server at http://localhost:4321
npm run docs:build              # sync, then a static build into site/dist
npm --prefix site run preview   # serve site/dist
```

The build fails on a broken internal link or `#anchor` (starlight-links-validator). Fix it in `docs/`, at the link.
Search is Starlight's built-in Pagefind; its index is made by the build, so it works in `preview`, not in `dev`.

## Environment variables

Both are read by the sync script and the build, so set them for `npm run docs:build`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOCS_SITE` | none | The origin the site is served from, such as `https://docs.example.com`. Used for canonical URLs and the sitemap. |
| `DOCS_BASE` | `/` | The path the site lives under, such as `/astera-orchestrator/` for a GitHub Pages project site. |

```bash
DOCS_SITE=https://janothedev.github.io DOCS_BASE=/astera-orchestrator/ npm run docs:build
```

## Host it

CI (`.github/workflows/ci.yml`, job `docs-site`) builds the site on every run and deploys nothing. Each host below
needs Node 24 (Astro needs at least 22.23.4), the install `npm ci --prefix site`, the build `npm run docs:build` run
from the repository root, and the output folder `site/dist`.

**GitHub Pages.** Pages needs a public repository, or a paid plan for a private one. In **Settings → Pages**, set the
source to **GitHub Actions**, then add a workflow that runs the install and build above with
`DOCS_SITE=https://<owner>.github.io` and `DOCS_BASE=/<repo>/`, and publishes `site/dist` with
`actions/upload-pages-artifact` and `actions/deploy-pages`. With a custom domain, set `DOCS_SITE` to it and leave
`DOCS_BASE` unset.

**Cloudflare Pages.** Connect the repository. Build command `npm ci --prefix site && npm run docs:build`, build output
directory `site/dist`, root directory left empty, and the environment variable `NODE_VERSION=24`. Set `DOCS_SITE` to
the `*.pages.dev` address or your domain.

**Netlify.** Connect the repository. Base directory left empty, build command
`npm ci --prefix site && npm run docs:build`, publish directory `site/dist`, and the environment variable
`NODE_VERSION=24`. Set `DOCS_SITE` to the `*.netlify.app` address or your domain.
