# Deploying Cadlets on Cloudflare

Cadlets is a static site: the brain runs in each visitor's browser, so there is no server to run
or scale. Cloudflare serves the files from its network as a Worker with static assets (no Worker
code; `wrangler.jsonc`). The free plan is enough: requests for static files are free and
unlimited, files can be up to 25 MiB (the largest here is 9.6 MiB) and there can be up to 20,000
of them (here 45). `_headers`, `_redirects` and `404.html` work as they do on Cloudflare Pages.

## What gets deployed

`python3 tools/build_site.py` copies what the browser loads into `dist/` (about 17 MiB) and checks
it: no file over 25 MiB, not too many files, and every page, stylesheet and script refers only to
files that are in the build. Cloudflare runs the same command on every push, then
`npx wrangler deploy` publishes `dist/` (as `wrangler.jsonc` says). To try exactly what will go
live:

```bash
python3 tools/build_site.py && python3 serve.py 8643 --root dist
```

`serve.py` applies `_headers` the way Cloudflare does and answers unknown addresses with
`404.html`, so a local run behaves like the live site (it does not apply `_redirects`).

## One-time setup

All of this happens in your Cloudflare and GitHub accounts; nothing needs to be installed.

1. Sign in at <https://dash.cloudflare.com> (a free account is enough).
2. **Workers & Pages → Create → Import a repository** (connect GitHub). When GitHub asks, install
   Cloudflare's app for the `cryptoleszto` account with **Only select repositories → Cadlets**.
   A private repo works.
3. Pick `cryptoleszto/Cadlets`. On **Set up your application**:

   | Setting | Value |
   |---|---|
   | Project name | `cadlets` (must match `"name"` in `wrangler.jsonc`) |
   | Build command | `python3 tools/build_site.py` |
   | Deploy command | `npx wrangler deploy` (the default) |
   | Non-production branch deploy command | leave the default |
   | Enable Preview builds | optional: other branches get their own preview address |
   | **Protect with Cloudflare Access** | **on** (see "Until the source and licence are decided") |
   | Advanced settings → root directory | `/` (the default) |
   | API token | let it create a new one |
   | Variables | none |

4. **Deploy.** The first build takes a minute or two. Its log shows
   `note: _redirects is included (the hard maintenance block is ON)` and
   `dist/: 45 files, 16.8 MiB`, then wrangler uploading the assets.
5. The address is `https://cadlets.<your-account>.workers.dev` (the Worker's page shows it).
   Before launch the site ships **closed** (see "Opening the site" below): the badge says
   MAINTENANCE, the landing page says "The Cadence is getting ready. Opening soon.", and `/play`
   sends you back to the landing page.

If the build fails, the log says why; the usual suspects are a project name that differs from
`wrangler.jsonc`, or a build image without `python3`.

## Opening the site

Until launch both maintenance switches are on. To open (once the source and licence are
decided, or just to try the live game yourself behind Cloudflare Access):

1. In `site.json`, set `"status": "open"`.
2. `git mv _redirects _redirects.maintenance`
3. Commit and push. About a minute later the badge says OPEN and PLAY boots the game (the first
   visit downloads about 8 MB; later visits load from the browser's cache).

To close again, do the reverse (see "Everyday use").

## Until the source and licence are decided

The `workers.dev` address is reachable by anyone as soon as it deploys, unless Cloudflare Access
guards it. The site ships the Cadence library, which is GPL-3.0, and offering it to the public is
what brings the obligation to offer the source. So until that is decided, keep the site to
yourself with Cloudflare Access (free for up to 50 people):

- Tick **Protect with Cloudflare Access** during setup, or later: the Worker's **Settings →
  Domains & Routes**, and enable Cloudflare Access for `workers.dev` and for Preview URLs.
- Allow only your email address. Check it in a private browser window: you should get a
  Cloudflare login asking for a one-time code by email before anything of the site shows.
- Turn it off when the site goes public.

Before going public, also check: the footer's "Source code" link points to the GitHub repo, which
shows a 404 to visitors while the repo is private.

## Everyday use

- **Deploy:** push to `main`; it is live a minute or two later. With preview builds on, every
  other branch gets its own preview address, handy for trying a change first.
- **Roll back:** the Worker's **Deployments** list → an earlier version → **Rollback**. It takes
  seconds and needs no push.
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

- **A custom domain:** the Worker's **Settings → Domains & Routes → Add → Custom domain** (the
  domain must be on Cloudflare). No redeploy needed.
- **Visitor counts:** Cloudflare Web Analytics is cookieless (no consent banner).
  It adds a script from `static.cloudflareinsights.com`, so the Content-Security-Policy in
  `_headers` must then allow it: add `https://static.cloudflareinsights.com` to `script-src` and
  `https://cloudflareinsights.com` to `connect-src`.
