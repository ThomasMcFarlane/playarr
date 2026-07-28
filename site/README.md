# Streamarr marketing site

The public marketing and documentation site for **Streamarr** (the server) and
**Playarr** (the clients). It is deliberately separate from
[`playarr.app`](https://playarr.app), which is the hosted Playarr *web client*
and its clients hub — this site is the product story and the installation
documentation, and links out to that app rather than replacing it.

Astro with MDX, static output, no runtime.

## Layout

```
site/
├── src/
│   ├── pages/            Marketing pages and the /legal/* pages
│   │   └── docs/         [...slug].astro renders the docs collection
│   ├── content/docs/     Installation and setup documentation (Markdown)
│   ├── components/       Shared UI primitives
│   ├── layouts/          BaseLayout (shell) and DocsLayout (sidebar)
│   ├── data/             Platform matrix and integration facts, shared
│   │                      between pages so they cannot drift apart
│   ├── styles/           Design tokens copied from the Playarr web client
│   └── consts.ts         Site strings, navigation, outbound links
├── scripts/check-copy.mjs  Copy compliance linter — see below
├── Dockerfile            Runs the dev server for the local cluster
└── k8s/                  Kubernetes manifests for a development deployment
```

## Local development

```sh
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # static output to dist/
pnpm check        # astro check + copy linter
```

To run it in a local Kubernetes cluster, apply the manifests in `k8s/`:

```sh
devdeploy streamarr-marketing
```

That serves the site at `streamarr-marketing.localhost`,
`streamarr-marketing.dev.home.arpa` and `streamarr-marketing.example.com`. The
production hostname is not settled yet; set `SITE_URL` at build time to control
canonical URLs, Open Graph tags and the sitemap.

## The copy linter — read this before writing any page

`scripts/check-copy.mjs` is not a style checker. It exists because
[`docs/artifacts/streamarr-legal-release.html`](../docs/artifacts/streamarr-legal-release.html)
concludes that for a project of this shape **the exposure surface is the
marketing, not the code** — TickBox, Grokster and Filmspeler were each sunk
primarily by their own promotional conduct rather than by what their software
did.

It enforces three things:

| Severity | Meaning |
| --- | --- |
| `error` | Acquisition-adjacent or adult-content-adjacent language. Never permitted anywhere on the site. |
| `claim` | Capability that is not generally available. Permitted only alongside an explicit status qualifier in the same file. |
| `review` | Genuinely ambiguous wording. Reported for a human; does not fail the build. |

Run it with `pnpm lint:copy`, or `pnpm lint:copy:strict` to fail on review hits
too. It runs as part of `pnpm check`.

## Rules the content must follow

1. **Streamarr plays media the operator already holds.** Nothing on this site
   describes acquiring, indexing, searching for or obtaining content.
2. **Never present planned work as shipped.** There is no 1.0 release and
   nothing is published to any app store on any platform. Anything unbuilt
   carries a visible label.
3. **The clients hub is the authority on availability.** Status wording in
   `src/data/platforms.ts` mirrors
   `clients/tv-web/web/src/pages/Clients.tsx`; if that changes, change this.
4. **Streamarr has no filesystem scanner.** Its catalogue is built entirely
   from connected library-management applications. Do not describe those
   connections as optional extras.
5. **The permission model is only partly enforced.** Library grants,
   `can_stream` and `can_download` are live; rating ceilings, tag rules,
   session caps and time windows are modelled but not yet called on any
   request path. The site must not claim parental controls.
6. **British English**, and the required FFmpeg, TMDB and trademark notices
   stay in the footer and on `/legal/licences`.
