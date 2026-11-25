import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../packages/cli/package.json");
const backup = `${pkgPath}.pack-backup`;
const mode = process.argv[2];

if (mode === "strip") {
  if (!existsSync(backup)) copyFileSync(pkgPath, backup);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  delete pkg.devDependencies;
  delete pkg.scripts;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
} else if (mode === "restore") {
  if (!existsSync(backup)) process.exit(0);
  copyFileSync(backup, pkgPath);
  unlinkSync(backup);
} else {
  console.error("usage: cli-pack.mjs strip|restore");
  process.exit(1);
}
