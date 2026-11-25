import { build } from "esbuild";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "packages/cli/dist/main.js");
const policyDir = join(root, "packages/cli/policies");

await build({
  entryPoints: [join(root, "packages/cli/src/main.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile,
  external: ["@cedar-policy/cedar-wasm", "@cedar-policy/cedar-wasm/nodejs"],
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "info",
});

mkdirSync(policyDir, { recursive: true });
copyFileSync(join(root, "policies/mandates.cedar"), join(policyDir, "mandates.cedar"));
chmodSync(outfile, 0o755);
