# Deploying Cadlets on Cloudflare Pages

Cadlets is a static site: the brain runs in each visitor's browser, so there is no server to run
or scale. Cloudflare Pages serves the files from its network. The free plan is enough: unlimited
requests and bandwidth for static files, 500 builds a month, files up to 25 MiB (the largest here
is 9.6 MiB) and up to 20,000 files (here 44).

## What gets deployed

`python3 tools/build_site.py` copies what the browser loads into `dist/` (about 17 MiB) and checks
it: no file over 25 MiB, not too many files, and every page, stylesheet and script refers only to
files that are in the build. Cloudflare runs the same command on every push. To try exactly what
will go live:

```bash
python3 tools/build_site.py && python3 serve.py 8643 --root dist
```

`serve.py` applies `_headers` the way Cloudflare does and answers unknown addresses with
`404.html`, so a local run behaves like the live site.

## One-time setup

All of this happens in your Cloudflare and GitHub accounts; nothing needs to be installed.

1. Sign in at <https://dash.cloudflare.com> (a free account is enough).
2. **Workers & Pages → Create → Pages → Connect to Git.** If the dashboard offers a Worker
   first, pick the Pages option.
3. Choose **GitHub**. When GitHub asks, install the Cloudflare Pages app for the `cryptoleszto`
   account with **Only select repositories → Cadlets**. A private repo works.
4. Select `Cadlets` → **Begin setup**:

   | Setting | Value |
   |---|---|
   | Project name | `cadlets` (this becomes `cadlets.pages.dev`; if it is taken, the name you pick is the address) |
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | `python3 tools/build_site.py` |
   | Build output directory | `dist` |
   | Root directory | leave empty |

5. **Save and Deploy.** The first build takes about a minute; its log ends with
   `dist/: 44 files, 16.8 MiB`.
6. Open `https://cadlets.pages.dev`: the badge should say OPEN, and PLAY should boot the game
   (the first visit downloads about 8 MB; later visits load from the browser's cache).

## Until the source and licence are decided

The `pages.dev` address is reachable by anyone as soon as it deploys. The site ships the Cadence
library, which is GPL-3.0, and offering it to the public is what brings the obligation to offer
the source. So until that is decided, keep the site to yourself with Cloudflare Access (free for
up to 50 people):

- **Zero Trust → Access → Applications → Add an application → Self-hosted**, domain
  `cadlets.pages.dev` (and `*.cadlets.pages.dev` for preview builds), with a policy that allows
  only your email address. Visitors then get a one-time code by email before the site opens.
- Remove the application when the site goes public.

Before going public, also check: the footer's "Source code" link points to the GitHub repo, which
shows a 404 to visitors while the repo is private.

## Everyday use

- **Deploy:** push to `main`; it is live about a minute later. Every other branch gets its own
  preview address (`<branch>.cadlets.pages.dev`), handy for trying a change first.
- **Roll back:** the project's **Deployments** list → an earlier deployment → **Rollback to this
  deployment**. It takes seconds and needs no push.
- **Soft maintenance:** set `"status": "maintenance"` in `site.json`, optionally a `"message"` and a
  `"back"` time, and push. The landing page shows UNDER MAINTENANCE instead of PLAY; the game sends
  new arrivals back to it, and players already in a game are saved and sent there within five
  minutes. `site.json` is never cached, so it applies with the next page load. Set it back to
  `"open"` and push to reopen.
- **Hard maintenance:** `git mv _redirects.maintenance _redirects` and push: every request for the
  game page redirects to the landing page, whatever `site.json` says (a game that is already open
  keeps running until it is reloaded or the soft switch sends it away, so for real maintenance use
  both). The build log notes when the block is on. Rename it back and push to reopen.
- **New Pyodide or Cadence version:** give it a new name (`vendor/pyodide-<version>/`, a new wheel
  name), and update `js/worker.js` and the cache rules in `_headers`. Those files are cached for a
  year, so a changed file under an old name would not reach returning visitors.

## The response headers (`_headers`)

- **Content Security Policy:** the pages load nothing from other sites. Pyodide may compile
  WebAssembly, and the mind panel may use inline style attributes; nothing else is allowed.
- **No framing, no MIME sniffing, a strict referrer, no camera, microphone or location.**
- **Caching:** `site.json` is never cached. The brain's runtime (about 16 MB) and the fonts are
  cached for a year, because their names carry their versions. Everything else (pages, scripts,
  the simulation) is revalidated on every visit, so a deploy is seen at once.

## Optional, later

- **A custom domain:** the project's **Custom domains → Set up a domain**. No redeploy needed.
- **Visitor counts:** the project's **Metrics → Web Analytics** is cookieless (no consent banner).
  It adds a script from `static.cloudflareinsights.com`, so the Content-Security-Policy in
  `_headers` must then allow it: add `https://static.cloudflareinsights.com` to `script-src` and
  `https://cloudflareinsights.com` to `connect-src`.
