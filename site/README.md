# Agent License site

A static landing page for this repository. It does not import the packages, and it has no build step. Fonts are self-hosted. The page makes no network calls except the links you follow.

The license card decodes sample compact JWTs captured from `agentlicense`. The quoted command output is from that same run. The large sentence at the top is printed by `pnpm demo` on pull request #1 (`cursor/explicit-delegation-chain-dcd7`). Main does not render it.

## Preview locally

From the repository root:

```sh
python3 -m http.server -d site 8080
```

Open `http://127.0.0.1:8080`. Serving the folder matters: the page loads `samples.js` and the fonts from it. Opening `index.html` as a file will not.

## Deploy

No install and no build. Publish the `site` directory as static files.

**Vercel.** Import the repository, set the root directory to `site`, leave the framework as Other, and leave the build command empty. `vercel.json` only sets a referrer policy and `X-Content-Type-Options`.

**GitHub Pages.** Publish the `site` directory (GitHub Actions with the static site, or by copying it to the Pages branch). `.nojekyll` is included so Jekyll does not rewrite the folder. This repository is private, so Pages may stay off until the repository visibility allows it.

There is no preview deployment attached to this page in the repository.

## Samples

`samples.js` holds the issuer public key and the compact JWTs from one local run. Private keys are not in this folder. The transcripts in `index.html` are the stdout and stderr of that run, plus one live checkpoint capture (`licensed(fetch)` against a local issuer, checkpoint, Cedar PDP, Merkle log, and demo tool).

If the CLI output changes, recapture it and update `samples.js` and the transcripts together. The card checks the Ed25519 signature only. It does not enforce the one-hour expiry on those tokens.
