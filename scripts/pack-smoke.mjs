import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const packDir = mkdtempSync(join(tmpdir(), "agentlicense-pack-"));
const scratch = mkdtempSync(join(tmpdir(), "agentlicense-install-"));
try {
  for (const dir of ["packages/core", "packages/sdk", "packages/cli"]) {
    run("pnpm", ["pack", "--pack-destination", packDir], { cwd: join(root, dir) });
  }
  const tarballs = readdirSync(packDir).filter((file) => file.endsWith(".tgz")).sort();
  if (tarballs.length !== 3) {
    console.error(`expected 3 tarballs, got ${tarballs.join(", ")}`);
    process.exit(1);
  }
  const cliPack = tarballs.find((file) => /^agentlicense-\d/.test(file));
  const cliManifest = run("tar", ["-xOf", join(packDir, cliPack), "package/package.json"]);
  const cli = JSON.parse(cliManifest);
  if (cli.devDependencies) {
    console.error("published CLI manifest still has devDependencies");
    process.exit(1);
  }
  if (!cli.dependencies?.["@cedar-policy/cedar-wasm"]) {
    console.error("published CLI is missing @cedar-policy/cedar-wasm");
    process.exit(1);
  }
  if (cli.scripts) {
    console.error("published CLI manifest still has scripts");
    process.exit(1);
  }
  const sdkPack = tarballs.find((file) => file.includes("sdk"));
  const sdk = JSON.parse(run("tar", ["-xOf", join(packDir, sdkPack), "package/package.json"]));
  if (String(sdk.dependencies?.["@agentlicense/core"] ?? "").includes("workspace:")) {
    console.error("SDK tarball still uses the workspace protocol");
    process.exit(1);
  }
  const byName = {
    core: tarballs.find((file) => file.includes("core")),
    sdk: tarballs.find((file) => file.includes("sdk")),
    cli: tarballs.find((file) => /^agentlicense-\d/.test(file)),
  };
  writeFileSync(
    join(scratch, "package.json"),
    JSON.stringify(
      {
        private: true,
        dependencies: {
          "@agentlicense/core": `file:${join(packDir, byName.core)}`,
          "@agentlicense/sdk": `file:${join(packDir, byName.sdk)}`,
          agentlicense: `file:${join(packDir, byName.cli)}`,
        },
        overrides: {
          "@agentlicense/core": `file:${join(packDir, byName.core)}`,
        },
      },
      null,
      2,
    ),
  );
  run("npm", ["install", "--ignore-scripts"], { cwd: scratch });
  const help = run("npx", ["agentlicense", "--help"], { cwd: scratch });
  if (!help.includes("keys init") || !help.includes("--user-request")) {
    console.error(help);
    process.exit(1);
  }
  const probe = `
    import { licensed } from "@agentlicense/sdk";
    import { AGENT_INITIATED_CEILING } from "@agentlicense/core";
    if (typeof licensed !== "function") throw new Error("licensed missing");
    if (!AGENT_INITIATED_CEILING.actions.includes("clock.read")) throw new Error("ceiling missing");
    console.log("sdk ok");
  `;
  const probeFile = join(scratch, "probe.mjs");
  writeFileSync(probeFile, probe);
  const probeOut = run("node", [probeFile], { cwd: scratch });
  if (!probeOut.includes("sdk ok")) process.exit(1);
  console.log(`pack smoke ok (${tarballs.join(", ")})`);
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
  const backup = join(root, "packages/cli/package.json.pack-backup");
  try {
    readFileSync(backup);
    console.error("CLI package.json backup was left behind");
    process.exitCode = 1;
  } catch {
    // restored
  }
}
