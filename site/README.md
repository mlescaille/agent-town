# Agent License site

Static landing page. It does not import the packages and it has no build step. Fonts are self-hosted. The page makes no network calls except the links you follow.

The credential card decodes the `user_goal` sample from `samples.js` and checks its Ed25519 signature in the browser. `agentlicense` is not published on npm. The install pill shows `pnpm exec agentlicense`. Copying it copies `pnpm i && pnpm build && pnpm exec agentlicense`, which runs inside a clone of this repository.

## Preview locally

From the repository root:

```sh
python3 -m http.server -d site 8080
```

Open `http://127.0.0.1:8080`.

## Deploy

Publish the `site` directory as static files. No install and no build.

**Vercel.** Set the root directory to `site`, leave the framework as Other, and leave the build command empty.

**GitHub Pages.** Publish the `site` directory. `.nojekyll` is included so Jekyll does not rewrite the folder.
