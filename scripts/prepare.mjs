/**
 * pnpm install of this repository builds the packages.
 * npm install of the git repository (no workspace install yet) hands off to pnpm,
 * then builds. That is the `npm i github:mlescaille/agent-town` path.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agent = process.env.npm_config_user_agent ?? "";
const insidePnpm = agent.startsWith("pnpm");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!insidePnpm && !existsSync(join(root, "packages/core/node_modules"))) {
  run("corepack", ["pnpm", "install", "--frozen-lockfile"]);
}

run(process.execPath, [join(root, "scripts/build.mjs")]);
