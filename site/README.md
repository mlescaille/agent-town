# Agent License site

Static landing page and docs. No install and no build step to preview. Fonts are self-hosted. Pages do not call the network except the links you follow.

Docs HTML under `site/docs/` is generated from `docs/*.md` by `pnpm render-docs` (that command needs a built CLI, because the CLI reference is `agentlicense --help`). Commit the generated HTML with the markdown.

The credential card on the landing page checks the sample Ed25519 signature in the browser. `agentlicense` is not on npm yet. The install pill copies the clone-and-build command.

## Preview

From the repository root:

```sh
python3 -m http.server -d site 8080
```

Open `http://127.0.0.1:8080`. Docs are at `/docs/`.

## Deploy

The repository is private. GitHub Pages and a public Vercel URL will not be reachable until it is public, or until the host is given access.

**Vercel.** Root directory `site`. Framework Other. Build command empty. `vercel.json` turns on clean URLs and trailing slashes. Canonical URLs in the HTML use `https://mlescaille.github.io/agent-town`. If Vercel is the host you actually use, change `scripts/site.config.json` and the canonical tags in `site/index.html`, then run `pnpm render-docs`.

**GitHub Pages.** `.github/workflows/pages.yml` publishes the `site` directory on pushes to `main`. Enable Pages with GitHub Actions as the source. The project URL is `https://mlescaille.github.io/agent-town/`. `.nojekyll` is included.

`robots.txt`, `sitemap.xml`, `llms.txt`, and `llms-full.txt` live in this directory. `/.well-known/agent-license.json` is a proposed descriptor. It is not registered with IANA, and the checkpoint code does not fetch it.
