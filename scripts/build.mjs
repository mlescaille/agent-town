import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const tsc = require.resolve("typescript/lib/tsc.js");

function run(args, cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const groups = [
  ["packages/core"],
  ["packages/sdk", "services/issuer", "services/checkpoint", "services/log", "services/pdp"],
  ["packages/cli", "examples/demo"],
];

for (const group of groups) {
  for (const dir of group) run([tsc, "-p", "tsconfig.json"], join(root, dir));
}
run([join(root, "scripts/bundle-cli.mjs")]);

const binDir = join(root, "node_modules/.bin");
mkdirSync(binDir, { recursive: true });
const link = join(binDir, "agentlicense");
rmSync(link, { force: true });
symlinkSync("../../packages/cli/dist/main.js", link);
